/**
 * Kuru market maker for one Floorline protection token (Monad testnet).
 *
 * Every cycle it reads the vault's own price for the token, builds a ladder of bids and asks around it
 * (see quotes.ts) and, when the price has moved or an order was filled, replaces its resting orders in
 * one transaction (Kuru's batchUpdate: cancel and place together). The result is a live two sided
 * market on Kuru's order book, priced by the vault.
 *
 *   npm run kuru            read only: prints the ladder it would post
 *   KURU_TRADING=1 npm run kuru
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { type Address, type Hex, createPublicClient, createWalletClient, decodeEventLog, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { initLog, log } from "../log.js";
import { type Book, type Level, type MakerState, type Resting, ladder, nextState, shouldRequote } from "./quotes.js";

const env = (k: string, d?: string) => process.env[k] ?? d ?? "";
const RPC = env("KURU_RPC_URL", "https://testnet-rpc.monad.xyz");
const BOOK = env("KURU_BOOK", "0x75E4f0ae3F8C1Be093eFe08818770d034d4103C8") as Address;
const MARGIN = env("KURU_MARGIN", "0xd029C2D98ff85D8F64799017fE00a59B1159CE02") as Address;
const VAULT = env("KURU_VAULT", "0x25541C105A727BFc266509cCdbA1327F2c0a6895") as Address;
const SERIES = BigInt(env("KURU_SERIES", "0"));
const EVERY_MS = Number(env("KURU_EVERY_MS", "60000"));
const TRADING = env("KURU_TRADING") === "1";
const STATE = "logs/kuru-orders.json";

const bookAbi = parseAbi([
  "function getMarketParams() view returns (uint32 pricePrecision, uint96 sizePrecision, address base, uint256 baseDecimals, address quote, uint256 quoteDecimals, uint32 tickSize, uint96 minSize, uint96 maxSize, uint256 takerFeeBps, uint256 makerFeeBps)",
  "function batchUpdate(uint32[] buyPrices, uint96[] buySizes, uint32[] sellPrices, uint96[] sellSizes, uint40[] orderIdsToCancel, bool postOnly)",
  "function s_orders(uint40) view returns (address ownerAddress, uint96 size, uint40 prev, uint40 next, uint40 flippedId, uint32 price, uint32 flippedPrice, bool isBuy)",
  "function bestBidAsk() view returns (uint256 bid, uint256 ask)",
  "event OrderCreated(uint40 orderId, address owner, uint96 size, uint32 price, bool isBuy)",
]);
const marginAbi = parseAbi(["function getBalance(address user, address token) view returns (uint256)"]);
const vaultAbi = parseAbi(["function quote(uint256 seriesId, uint256 amount) view returns (uint256 premium)", "function spreadBps() view returns (uint256)"]);

const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });

const load = (): MakerState => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { resting: [] });
const save = (s: MakerState) => writeFileSync(STATE, JSON.stringify(s));

async function cycle(me: Address, book: Book, base: Address, quote: Address, baseDecimals: number, quoteDecimals: number, send?: ReturnType<typeof createWalletClient>) {
  const state = load();
  // the vault's price for one token, from a quote on 1,000 so rounding does not matter.
  // If the vault will not quote (stale price, paused, series closed) there is no price to stand behind.
  let mint = 0;
  try {
    const premium = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "quote", args: [SERIES, 1000n * 10n ** 18n] });
    mint = Number(premium) / 10 ** quoteDecimals / 1000;
  } catch (e) {
    log("kuru_no_vault_price", { error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
  }

  // which of our orders are still resting untouched
  const live: Resting[] = [];
  let changed = false;
  for (const o of state.resting) {
    const [owner, size] = await pub.readContract({ address: BOOK, abi: bookAbi, functionName: "s_orders", args: [o.id] });
    if (owner.toLowerCase() !== me.toLowerCase() || size === 0n) {
      changed = true; // filled or gone
      continue;
    }
    if (size.toString() !== o.size) changed = true; // partly filled
    live.push(o);
  }

  const [freeBase, freeQuote] = await Promise.all([
    pub.readContract({ address: MARGIN, abi: marginAbi, functionName: "getBalance", args: [me, base] }),
    pub.readContract({ address: MARGIN, abi: marginAbi, functionName: "getBalance", args: [me, quote] }),
  ]);
  // what is locked in our own resting orders comes back when we cancel them in the same transaction
  let tokens = Number(freeBase) / 10 ** baseDecimals;
  let cash = Number(freeQuote) / 10 ** quoteDecimals;
  for (const o of live) {
    const [, size, , , , price, , isBuy] = await pub.readContract({ address: BOOK, abi: bookAbi, functionName: "s_orders", args: [o.id] });
    const t = Number(size) / book.sizePrecision;
    if (isBuy) cash += t * (price / book.pricePrecision);
    else tokens += t;
  }

  // with no vault price the ladder is empty, so the requote below only cancels: the book never shows a
  // price the vault has stopped backing
  const want = ladder(mint, book, tokens, cash);
  const pull = !(mint > 0) && live.length > 0;
  const [bid, ask] = await pub.readContract({ address: BOOK, abi: bookAbi, functionName: "bestBidAsk" });
  log("kuru_quote", { mint, tokens, cash, bestBid: bid > 10n ** 30n ? null : Number(bid) / 1e18, bestAsk: Number(ask) / 1e18, bids: want.bids.map(show(book)), asks: want.asks.map(show(book)), resting: live.length });

  if (!(mint > 0) && live.length === 0) return; // nothing resting and nothing to quote
  if (!pull && !shouldRequote(state.mint, mint, changed || live.length !== state.resting.length)) return;
  if (!send) {
    log("kuru_dry_run", { note: "set KURU_TRADING=1 to post these orders" });
    return;
  }
  const hash = await send.writeContract({
    chain,
    account: send.account!,
    address: BOOK,
    abi: bookAbi,
    functionName: "batchUpdate",
    args: [want.bids.map((l) => l.price), want.bids.map((l) => l.size), want.asks.map((l) => l.price), want.asks.map((l) => l.size), live.map((o) => o.id), true],
    gas: 1_500_000n,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const placed: Resting[] = [];
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== BOOK.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: bookAbi, data: l.data, topics: l.topics });
      if (ev.eventName === "OrderCreated" && ev.args.owner.toLowerCase() === me.toLowerCase()) placed.push({ id: ev.args.orderId, size: ev.args.size.toString() });
    } catch {
      /* another event on the book */
    }
  }
  const ok = receipt.status === "success";
  save(nextState(state, live, ok, placed, mint > 0 ? mint : undefined));
  if (ok) log("kuru_requote", { hash, status: receipt.status, cancelled: live.length, placed: placed.length, mint });
  else log("kuru_requote_failed", { hash, kept: live.length });
}

const show = (book: Book) => (l: Level) => `${(Number(l.size) / book.sizePrecision).toFixed(0)} @ ${(l.price / book.pricePrecision).toFixed(6)}`;

async function main() {
  initLog("logs");
  const key = env("KEEPER_PRIVATE_KEY") as Hex;
  if (!key) throw new Error("KEEPER_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(key);
  const send = TRADING ? createWalletClient({ account, chain, transport: http(RPC) }) : undefined;
  const p = await pub.readContract({ address: BOOK, abi: bookAbi, functionName: "getMarketParams" });
  const book: Book = { pricePrecision: Number(p[0]), sizePrecision: Number(p[1]), tick: Number(p[6]), minSize: p[7] };
  log("kuru_mode", { book: BOOK, vault: VAULT, series: Number(SERIES), maker: account.address, trading: TRADING, everyMs: EVERY_MS });
  for (;;) {
    try {
      await cycle(account.address, book, p[2], p[4], Number(p[3]), Number(p[5]), send);
    } catch (e) {
      log("kuru_error", { error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
    }
    if (env("KURU_ONCE") === "1") return;
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}
main();
