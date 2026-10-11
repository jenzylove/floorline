/**
 * Kuru Spot V2 market maker for a Floorline floor token (Monad testnet, market created by Kuru's team).
 *
 * Same idea as maker.ts on the older Router: read the vault's own price for the floor, keep a ladder of
 * asks just under it and bids under the floor's value, and replace the quotes when the price moves or a
 * fill changes the inventory. V2 holds balances in Kuru's custody contract, so a fill shows up as a
 * change in the maker's Kuru balances.
 *
 *   npm run kuru:v2                read only: prints the ladder it would post
 *   KURU_TRADING=1 npm run kuru:v2
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { orderBookAbi } from "@toxicflow-labs/ts-sdk/abi";
import { type Hex, parseAbi } from "viem";
import { initLog, log } from "../log.js";
import { DEFAULTS, type Level, ladder, shouldRequote } from "./quotes.js";
import { type Market, V2, accountIdOf, balances, clients, depositAll, pub, readMarket } from "./v2.js";

const EVERY_MS = Number(process.env.KURU_EVERY_MS ?? 60_000);
const TRADING = process.env.KURU_TRADING === "1";
const SIZE = Number(process.env.KURU_SIZE ?? 9_000); // floors per level; each level must clear the market's 10 USDC minimum
const STATE = "logs/kuru-v2.json";
const vaultAbi = parseAbi(["function quote(uint256 seriesId, uint256 amount) view returns (uint256 premium)"]);

interface State {
  mint?: number; // the vault price the resting quotes were built from
  base?: number; // inventory when they were posted, free plus reserved
  quote?: number;
  quoted: boolean;
}
const load = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { quoted: false });
const save = (s: State) => writeFileSync(STATE, JSON.stringify(s));
const show = (m: Market) => (l: Level) => `${(Number(l.size) / m.sizePrecision).toFixed(0)} @ ${(l.price / m.pricePrecision).toFixed(6)}`;

async function cycle(c: ReturnType<typeof clients>, m: Market, userId: bigint) {
  const state = load();
  let mint = 0;
  try {
    const premium = await pub.readContract({ address: V2.vault, abi: vaultAbi, functionName: "quote", args: [V2.series, 1000n * 10n ** 18n] });
    mint = Number(premium) / 10 ** m.quoteDecimals / 1000;
  } catch (e) {
    log("kuru_v2_no_vault_price", { error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
  }

  const [b, q] = await Promise.all([balances(userId, m.base, m.baseDecimals), balances(userId, m.quote, m.quoteDecimals)]);
  const base = b.free + b.reserved;
  const quote = q.free + q.reserved;
  // a fill moves floors one way and USDC the other; fees alone are far smaller than these thresholds
  const filled = state.quoted && state.base !== undefined && (Math.abs(base - state.base) > 1 || Math.abs(quote - (state.quote ?? quote)) > 0.01);

  const book = { pricePrecision: m.pricePrecision, sizePrecision: m.sizePrecision, tick: m.tick, minSize: 1n, minNotional: m.minQuoteNotional };
  const want = ladder(mint, book, base, quote, { ...DEFAULTS, sizeTokens: SIZE });
  log("kuru_v2_quote", { mint, floors: base, usdc: quote, filled, bids: want.bids.map(show(m)), asks: want.asks.map(show(m)), resting: state.quoted });

  const pull = !(mint > 0) && state.quoted;
  if (!pull && state.quoted && !shouldRequote(state.mint, mint, filled)) return;
  if (!pull && !state.quoted && want.bids.length + want.asks.length === 0) return;
  if (!TRADING) {
    log("kuru_v2_dry_run", { note: "set KURU_TRADING=1 to post these orders" });
    return;
  }

  // V2 cancels and places in separate calls. If the cancel fails, the old quotes still rest: keep the state.
  if (state.quoted) {
    const hash = await c.wallet.writeContract({ address: V2.market, abi: orderBookAbi, functionName: "cancelAllOrders", args: [Number(userId)], gas: 1_500_000n });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") {
      log("kuru_v2_cancel_failed", { hash });
      return;
    }
    save({ quoted: false });
    log("kuru_v2_cancelled", { hash });
  }
  if (want.bids.length + want.asks.length === 0) return;

  // Kuru's native order: side 0 buys and 1 sells, tif 0 rests until cancelled, instruction 1 is post only
  const order = (side: number) => (l: Level) => ({ side, quantity: l.size, price: l.price, tif: 0, executionInstruction: 1, minSizeAfterBlock: 0 });
  const orders = [...want.asks.map(order(1)), ...want.bids.map(order(0))];
  const hash = await c.wallet.writeContract({ address: V2.market, abi: orderBookAbi, functionName: "batch", args: [Number(userId), orders, []], gas: 3_000_000n });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") {
    log("kuru_v2_requote_failed", { hash });
    return;
  }
  save({ mint, base, quote, quoted: true });
  log("kuru_v2_requote", { hash, placed: orders.length, mint });
}

async function main() {
  initLog("logs");
  const key = process.env.KEEPER_PRIVATE_KEY as Hex;
  if (!key) throw new Error("KEEPER_PRIVATE_KEY is not set");
  const c = clients(key);
  const m = await readMarket();
  if (TRADING) for (const t of [m.base, m.quote]) await depositAll(c, t); // anything still in the wallet goes to work
  const userId = BigInt(await accountIdOf(c.account.address));
  if (userId === 0n) throw new Error("the maker has no Kuru account yet: deposit first");
  log("kuru_v2_mode", { market: V2.market, vault: V2.vault, maker: c.account.address, userId: Number(userId), trading: TRADING, everyMs: EVERY_MS, size: SIZE });
  for (;;) {
    try {
      await cycle(c, m, userId);
    } catch (e) {
      log("kuru_v2_error", { error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
    }
    if (process.env.KURU_ONCE === "1") return;
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}
main();
