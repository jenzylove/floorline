import { createPublicClient, http } from "viem";
import { loadConfig } from "./config.js";
import { initLog, log } from "./log.js";
import { fetchContext } from "./perpl/context.js";
import { MarketData } from "./perpl/marketData.js";
import { TradingClient, OrderType, Flags } from "./perpl/trading.js";
import { readExposure } from "./hedge/exposure.js";
import { decide } from "./hedge/policy.js";

const cfg = loadConfig();
initLog(cfg.logDir);

const { markets } = await fetchContext(cfg.perplApi);
for (const id of cfg.markets) {
  const m = markets.get(id);
  if (!m) throw new Error(`unknown Perpl market ${id}`);
  log("market", { id, name: m.name, priceDecimals: m.priceDecimals, sizeDecimals: m.sizeDecimals, ttl: m.orderTtlBlocks, mnpDefault: m.maxNegPnlCollatBps });
}

const md = new MarketData(cfg.perplWs, cfg.chainId, cfg.markets);
md.start();

const canTrade = cfg.tradingEnabled && !!cfg.apiKey && !!cfg.apiPrivateKeyHex;
const tr = canTrade
  ? new TradingClient(cfg.perplWs, cfg.chainId, cfg.apiKey!, cfg.apiPrivateKeyHex!, (mkt) => markets.get(mkt)?.orderTtlBlocks ?? 20)
  : undefined;
tr?.start();
log("mode", { trading: canTrade, reason: canTrade ? "api key + TRADING_ENABLED" : "read-only: no API key or TRADING_ENABLED != 1" });

const client = createPublicClient({ transport: http(cfg.rpcUrl) });
let busy = false;
let killed = false;

process.on("SIGINT", () => {
  killed = true;
  log("kill", { by: "SIGINT" });
  md.stop();
  tr?.stop();
  process.exit(0);
});

async function tick() {
  if (busy || killed) return;
  busy = true;
  try {
    for (const mkt of cfg.markets) {
      const spec = markets.get(mkt)!;
      const state = md.states.get(mkt);
      const book = md.books.get(mkt)!;
      if (!state || !md.connected) {
        log("hold", { mkt, reason: "no market data yet" });
        continue;
      }
      const spot = state.oracle / 10 ** spec.priceDecimals;

      let targetUnits = 0;
      if (cfg.vault) {
        const exp = await readExposure(client, cfg.vault, new Map([[mkt, spot]]));
        targetUnits = exp.targetUnits.get(mkt) ?? 0;
        log("exposure", { mkt, spot, targetUnits, series: exp.series });
      }

      const currentLots = tr?.shortLots(mkt) ?? 0;
      const equity = tr ? Number(tr.balance + tr.locked) / 1e6 : Infinity;
      const allowOpen = equity >= cfg.risk.minEquity;
      const d = decide(spec, cfg.risk, targetUnits, currentLots, state.mark, book.sortedBids(), book.sortedAsks(), allowOpen);
      log("decision", { mkt, head: md.head, mark: state.mark, funding: md.funding.get(mkt)?.rate, equity: tr ? equity : "read-only", ...d });

      if (d.kind !== "order" || !tr) continue;
      const outcome = await tr.place({
        mkt,
        t: d.side === "openShort" ? OrderType.OpenShort : OrderType.CloseShort,
        p: d.limitPrice,
        s: d.lots,
        fl: Flags.IOC,
        lv: 100, // 1x: the short is fully funded
        mnp: spec.maxNegPnlCollatBps,
      });
      log("hedge_result", { mkt, side: d.side, wanted: d.lots, filled: outcome.fs, price: outcome.fp, st: outcome.st, sr: outcome.sr, fr: outcome.fr });
    }
  } catch (e) {
    log("tick_error", { error: String(e) });
  } finally {
    busy = false;
  }
}

setTimeout(() => {
  tick();
  setInterval(tick, cfg.loopMs);
}, 3000);
