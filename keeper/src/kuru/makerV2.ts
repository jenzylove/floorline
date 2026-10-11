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
const LEVEL_USD = Number(process.env.KURU_LEVEL_USD ?? 18); // value of each level; the market rejects anything under 10 USDC
const REQUOTE_BPS = Number(process.env.KURU_REQUOTE_BPS ?? 300); // requote when the vault price has moved this far
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

/**
 * Monad charges for the gas limit, not the gas used, so a generous fixed limit drains the wallet. Estimate
 * each call and add 40% headroom; fall back to a fixed limit if the estimate itself fails.
 */
async function gasFor(estimate: () => Promise<bigint>, fallback: bigint): Promise<bigint> {
  try {
    return ((await estimate()) * 14n) / 10n;
  } catch {
    return fallback;
  }
}

async function cycle(c: ReturnType<typeof clients>, m: Market, userId: bigint) {
  const state = load();
  let mint = 0;
  try {
    const premium = await pub.readContract({ address: V2.vault, abi: vaultAbi, functionName: "quote", args: [V2.series, 1000n * 10n ** 18n] });
    mint = Number(premium) / 10 ** m.quoteDecimals / 1000;
  } catch (e) {
    log("kuru_v2_no_vault_price", { error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
  }

  const gasLeft = Number(await pub.getBalance({ address: c.account.address })) / 1e18;
  if (gasLeft < 0.5) log("kuru_v2_low_gas", { mon: gasLeft, note: "the maker needs testnet MON to requote" });
  const [b, q] = await Promise.all([balances(userId, m.base, m.baseDecimals), balances(userId, m.quote, m.quoteDecimals)]);
  const base = b.free + b.reserved;
  const quote = q.free + q.reserved;
  // a fill moves floors one way and USDC the other; fees alone are far smaller than these thresholds
  const filled = state.quoted && state.base !== undefined && (Math.abs(base - state.base) > 1 || Math.abs(quote - (state.quote ?? quote)) > 0.01);

  const book = { pricePrecision: m.pricePrecision, sizePrecision: m.sizePrecision, tick: m.tick, minSize: 1n, minNotional: m.minQuoteNotional };
  // floors per level follow the price, so each level stays worth about LEVEL_USD as the floor's value moves
  const sizeTokens = mint > 0 ? Math.ceil(LEVEL_USD / mint / 1000) * 1000 : 0;
  const want = ladder(mint, book, base, quote, { ...DEFAULTS, sizeTokens });
  log("kuru_v2_quote", { mint, floors: base, usdc: quote, filled, bids: want.bids.map(show(m)), asks: want.asks.map(show(m)), resting: state.quoted });

  const pull = !(mint > 0) && state.quoted;
  if (!pull && state.quoted && !shouldRequote(state.mint, mint, filled, REQUOTE_BPS)) return;
  if (!pull && !state.quoted && want.bids.length + want.asks.length === 0) return;
  if (!TRADING) {
    log("kuru_v2_dry_run", { note: "set KURU_TRADING=1 to post these orders" });
    return;
  }

  // V2 cancels and places in separate calls. If the cancel fails, the old quotes still rest: keep the state.
  if (state.quoted) {
    const call = { address: V2.market, abi: orderBookAbi, functionName: "cancelAllOrders", args: [Number(userId)] } as const;
    const hash = await c.wallet.writeContract({ ...call, gas: await gasFor(() => pub.estimateContractGas({ ...call, account: c.account }), 700_000n) });
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
  const call = { address: V2.market, abi: orderBookAbi, functionName: "batch", args: [Number(userId), orders, []] } as const;
  const hash = await c.wallet.writeContract({ ...call, gas: await gasFor(() => pub.estimateContractGas({ ...call, account: c.account }), 1_500_000n) });
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
  log("kuru_v2_mode", { market: V2.market, vault: V2.vault, maker: c.account.address, userId: Number(userId), trading: TRADING, everyMs: EVERY_MS, levelUsd: LEVEL_USD });
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
