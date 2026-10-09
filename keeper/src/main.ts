import { createPublicClient, http, stringToHex } from "viem";
import { loadConfig } from "./config.js";
import { initLog, log } from "./log.js";
import { fetchContext } from "./perpl/context.js";
import { MarketData } from "./perpl/marketData.js";
import { TradingClient, OrderType, Flags } from "./perpl/trading.js";
import { readExposure } from "./hedge/exposure.js";
import { decide } from "./hedge/policy.js";
import { VaultExecutor, withinOracleBand } from "./vault/onchain.js";
import { CycleLedger } from "./hedge/sweep.js";
import { parsePlan, seriesToCreate } from "./vault/series.js";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { fetchCandles, nextVol, realizedVol, volToWad } from "./vol.js";

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

const client = createPublicClient({ transport: http(cfg.rpcUrl) });

// ---------------------------------------------------------------- execution mode
const vaultMode = cfg.execution === "vault";
// The keeper key always posts the pricing vol and settles at expiry (either mode). It only places hedge
// orders in "vault" mode; in "api" mode orders go through Perpl's trading API from the operator account.
const keeperTx =
  cfg.vault && cfg.keeperKey && cfg.tradingEnabled
    ? new VaultExecutor(client as never, cfg.rpcUrl, cfg.chainId, cfg.keeperKey, cfg.vault)
    : undefined;
const ex = vaultMode ? keeperTx : undefined;
const apiTrading = !vaultMode && cfg.tradingEnabled && !!cfg.apiKey && !!cfg.apiPrivateKeyHex;
const tr = apiTrading
  ? new TradingClient(cfg.perplWs, cfg.chainId, cfg.apiKey!, cfg.apiPrivateKeyHex!, (mkt) => markets.get(mkt)?.orderTtlBlocks ?? 20)
  : undefined;
tr?.start();
log("mode", {
  execution: cfg.execution,
  trading: !!ex || apiTrading,
  keeper: keeperTx?.address,
  reason: ex || apiTrading ? "live" : "read-only: needs TRADING_ENABLED=1 plus KEEPER_PRIVATE_KEY (vault) or an API key (api)",
});

let busy = false;
let killed = false;
let lastVolAt = 0;
const ledgers = new Map<number, CycleLedger>();
const plan = parsePlan(cfg.seriesPlan);
let lastSeriesAt = 0;

/** Keep the standing menu of series open so the app always has protection to sell. */
async function rollSeries(mkt: number) {
  if (!keeperTx || plan.length === 0 || Date.now() - lastSeriesAt < cfg.seriesEveryMs) return;
  lastSeriesAt = Date.now();
  try {
    const now = Math.floor(Date.now() / 1000);
    const todo = seriesToCreate(plan, await keeperTx.openSeries(mkt), await keeperTx.spot6(mkt), now);
    for (const t of todo) {
      log("series_create", { mkt, ...t });
      await keeperTx.createSeries(mkt, t.strike, t.expiry);
    }
  } catch (e) {
    log("series_error", { mkt, error: String(e).slice(0, 300) });
  }
}

process.on("SIGINT", () => {
  killed = true;
  log("kill", { by: "SIGINT" });
  md.stop();
  tr?.stop();
  process.exit(0);
});

/** Post the pricing vol from Perpl's candles, inside VolFeed's step limit. Fails closed: no number, no post. */
async function postVol(mkt: number) {
  const ex = keeperTx;
  if (!ex || cfg.vol.everyMs <= 0 || Date.now() - lastVolAt < cfg.vol.everyMs) return;
  lastVolAt = Date.now();
  try {
    const candles = await fetchCandles(cfg.perplApi, mkt, cfg.vol.candleSeconds, cfg.vol.windowHours);
    const rv = realizedVol(candles, cfg.vol.candleSeconds);
    if (rv === undefined) {
      log("vol_skip", { mkt, reason: `too few candles (${candles.length})` });
      return;
    }
    const feed = await ex.volFeed();
    const cur = await ex.currentVol(feed, mkt);
    const v = nextVol(rv, cur.vol || undefined, cur.maxStepBps);
    log("vol", { mkt, measured: rv, previous: cur.vol, posting: v, stepLimited: Math.abs(v - Math.min(5, Math.max(0.1, rv))) > 1e-9 });
    await ex.postVol(feed, mkt, volToWad(v), stringToHex(`perpl-rv-${cfg.vol.windowHours}h`, { size: 32 }));
  } catch (e) {
    log("vol_error", { mkt, error: String(e).slice(0, 300) });
  }
}

async function tick() {
  if (busy || killed) return;
  busy = true;
  try {
    if (keeperTx && cfg.vault) {
      const n = await keeperTx.settleExpired();
      if (n) log("settled", { count: n });
    }
    for (const mkt of cfg.markets) {
      await postVol(mkt);
      await rollSeries(mkt);

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

      const currentLots = ex ? await ex.shortLots(mkt) : (tr?.shortLots(mkt) ?? 0);
      const equity = ex ? await ex.equity() : tr ? Number(tr.balance + tr.locked) / 1e6 : Infinity;
      const allowOpen = equity >= cfg.risk.minEquity;
      const d = decide(spec, cfg.risk, targetUnits, currentLots, state.mark, book.sortedBids(), book.sortedAsks(), allowOpen);
      if (tr && cfg.vault) {
        // operator sweep: one line per finished hedge cycle, also written to logs/sweeps.jsonl for /proof
        const ledger = ledgers.get(mkt) ?? new CycleLedger();
        ledgers.set(mkt, ledger);
        const due = ledger.observe(targetUnits, currentLots, equity);
        if (due) {
          log("sweep_due", { mkt, vault: cfg.vault, ...due });
          try {
            appendFileSync(join(cfg.logDir, "sweeps.jsonl"), JSON.stringify({ mkt, vault: cfg.vault, ...due }) + "\n");
          } catch {
            /* logging must never stop the bot */
          }
        }
      }
      log("decision", { mkt, head: md.head, mark: state.mark, oracle: state.oracle, funding: md.funding.get(mkt)?.rate, equity: ex || tr ? equity : "read-only", ...d });
      if (d.kind !== "order") continue;

      if (ex) {
        const band = await ex.bandBps();
        const open = d.side === "openShort";
        if (!withinOracleBand(open, d.limitPrice, state.oracle, band)) {
          log("hold", { mkt, reason: `limit ${d.limitPrice} outside ${band} bps of oracle ${state.oracle}` });
          continue;
        }
        const before = currentLots;
        const r = await ex.hedge(mkt, open, d.lots, d.limitPrice);
        log("hedge_result", { mkt, side: d.side, wanted: d.lots, ok: r.ok, hash: r.hash, shortBefore: before, shortAfter: await ex.shortLots(mkt) });
      } else if (tr) {
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
    }
  } catch (e) {
    log("tick_error", { error: String(e).slice(0, 500) });
  } finally {
    busy = false;
  }
}

setTimeout(() => {
  tick();
  setInterval(tick, cfg.loopMs);
}, 3000);
