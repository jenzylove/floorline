/**
 * The floor ladder on Kuru (Monad testnet).
 *
 * Keeps a set of floors open at once (see ladderPlan.ts: 3%, 6% and 10% under MON for a day, 5%, 10% and
 * 15% under MON for a week). For each one it opens a vault series, gives it its own Kuru order book on
 * Kuru's Router, lists the book in the KuruLadder registry so the app can find it, and quotes both sides
 * around the vault's own price. When a floor nears its end a new one opens at today's price; when it
 * ends, the bot pulls its orders and settles it.
 *
 *   npm run kuru:ladder              read only: prints what it would do
 *   KURU_TRADING=1 npm run kuru:ladder
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { type Address, type Hex, createPublicClient, createWalletClient, decodeEventLog, defineChain, erc20Abi, http, maxUint256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { initLog, log } from "../log.js";
import { type Entry, SLOTS, expiryFor, missing, quotable, strikeFor, toSettle } from "./ladderPlan.js";
import { type Book, type QuoteParams, type Resting, DEFAULTS, ladder, nextState, shouldRequote } from "./quotes.js";

const env = (k: string, d?: string) => process.env[k] ?? d ?? "";
const RPC = env("KURU_RPC_URL", "https://testnet-rpc.monad.xyz");
const VAULT = env("LADDER_VAULT", "0xc8EDB9e8E1E0e30951b14FD8BF45f06A9332F894") as Address;
const REGISTRY = env("LADDER_REGISTRY", "0x9ccFD82dA30022b06bB9325aE22dA02dde5Cb293") as Address;
const ROUTER = env("KURU_ROUTER", "0x7EFbE105Ca7415dE98F96622173458ac1c054630") as Address;
const MARGIN = env("KURU_MARGIN", "0xd029C2D98ff85D8F64799017fE00a59B1159CE02") as Address;
const EVERY_MS = Number(env("KURU_EVERY_MS", "180000"));
const TRADING = env("KURU_TRADING") === "1";
const LEVEL = Number(env("LADDER_LEVEL_FLOORS", "1000")); // floors per order
const CASH_PER_BOOK = Number(env("LADDER_CASH_PER_BOOK", "25")); // USDC each book may bid with
const STATE = "logs/kuru-ladder.json";

// every book: price in 1e-8 USDC per floor (premiums are fractions of a cent), size in 1e-6 floors
const PRICE_PRECISION = 100_000_000;
const SIZE_PRECISION = 1_000_000n;
const BOOK: Book = { pricePrecision: PRICE_PRECISION, sizePrecision: Number(SIZE_PRECISION), tick: 1, minSize: SIZE_PRECISION };
const QUOTES: QuoteParams = { ...DEFAULTS, sizeTokens: LEVEL };

const vaultAbi = parseAbi([
  "function quote(uint256 seriesId, uint256 amount) view returns (uint256)",
  "function seriesCount() view returns (uint256)",
  "function priceSource() view returns (address)",
  "function createSeries(uint256 marketId, uint256 strike, uint64 expiry) returns (uint256)",
  "function getSeries(uint256) view returns ((uint256 marketId, uint256 strike, uint64 expiry, bool settled, address token, uint256 locked, uint256 payoutPerToken, uint256 settlePrice, uint256 owed))",
  "function buy(uint256 seriesId, uint256 amount, uint256 maxPremium, address receiver) returns (uint256)",
  "function settle(uint256 seriesId)",
  "function asset() view returns (address)",
]);
const priceAbi = parseAbi(["function price(uint256 marketId) view returns (uint256 price6, uint256 updatedAt)"]);
const routerAbi = parseAbi([
  "function deployProxy(uint8 _type, address _baseAssetAddress, address _quoteAssetAddress, uint96 _sizePrecision, uint32 _pricePrecision, uint32 _tickSize, uint96 _minSize, uint96 _maxSize, uint256 _takerFeeBps, uint256 _makerFeeBps, uint96 _kuruAmmSpread) returns (address proxy)",
]);
const bookAbi = parseAbi([
  "function batchUpdate(uint32[] buyPrices, uint96[] buySizes, uint32[] sellPrices, uint96[] sellSizes, uint40[] orderIdsToCancel, bool postOnly)",
  "function s_orders(uint40) view returns (address ownerAddress, uint96 size, uint40 prev, uint40 next, uint40 flippedId, uint32 price, uint32 flippedPrice, bool isBuy)",
  "event OrderCreated(uint40 orderId, address owner, uint96 size, uint32 price, bool isBuy)",
]);
const marginAbi = parseAbi(["function getBalance(address user, address token) view returns (uint256)", "function deposit(address _user, address _token, uint256 _amount) payable"]);
const registryAbi = parseAbi(["function add(uint256 seriesId, address book)", "function bookOf(uint256) view returns (address)"]);

const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });

type BookState = { resting: Resting[]; mint?: number };
type State = { entries: Entry[]; books: Record<string, BookState> };
const load = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { entries: [], books: {} });
const save = (s: State) => writeFileSync(STATE, JSON.stringify(s, null, 1));
const short = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

type Wallet = ReturnType<typeof createWalletClient>;

async function send(w: Wallet, req: Parameters<Wallet["writeContract"]>[0]) {
  const hash = await w.writeContract(req);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted ${hash}`);
  return { hash, receipt: r };
}

async function ensureAllowance(w: Wallet, token: Address, spender: Address, need: bigint) {
  const me = w.account!.address;
  const have = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [me, spender] });
  if (have < need) await send(w, { chain, account: w.account!, address: token, abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] });
}

/** Open a new series for a slot, give it a Kuru book, and list the book. */
async function open(w: Wallet, state: State, marketId: bigint, usdc: Address, spot6: number, days: 1 | 7, pct: number, now: number) {
  const strike = strikeFor(spot6, pct);
  const expiry = expiryFor(days, now);
  const id = Number(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "seriesCount" }));
  const made = await send(w, { chain, account: w.account!, address: VAULT, abi: vaultAbi, functionName: "createSeries", args: [marketId, BigInt(strike), BigInt(expiry)] });
  const s = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "getSeries", args: [BigInt(id)] });
  const args = [0, s.token, usdc, SIZE_PRECISION, PRICE_PRECISION, 1, SIZE_PRECISION, 10n ** 15n, 30n, 10n, 100n] as const;
  const sim = await pub.simulateContract({ account: w.account!, address: ROUTER, abi: routerAbi, functionName: "deployProxy", args });
  const deployed = await send(w, sim.request as never);
  const book = sim.result;
  const listed = await send(w, { chain, account: w.account!, address: REGISTRY, abi: registryAbi, functionName: "add", args: [BigInt(id), book] });
  const entry: Entry = { id, token: s.token, book, strike, expiry, days, pct };
  state.entries.push(entry);
  state.books[book] = { resting: [] };
  save(state);
  log("ladder_open", { id, days, pct, strike: strike / 1e6, expiry, token: s.token, book, series: made.hash, market: deployed.hash, listed: listed.hash });
}

/** Keep LEVEL x 3 floors of a series in Kuru's margin account, minted from the vault when short. */
async function stock(w: Wallet, e: Entry, inOrders: number) {
  const me = w.account!.address;
  const token = e.token as Address;
  const target = LEVEL * QUOTES.askSteps.length;
  const inMargin = Number(await pub.readContract({ address: MARGIN, abi: marginAbi, functionName: "getBalance", args: [me, token] })) / 1e18;
  const short = Math.floor(target - inMargin - inOrders);
  if (short < LEVEL) return;
  const amount = BigInt(short) * 10n ** 18n;
  const premium = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "quote", args: [BigInt(e.id), amount] });
  const bought = await send(w, { chain, account: w.account!, address: VAULT, abi: vaultAbi, functionName: "buy", args: [BigInt(e.id), amount, (premium * 105n) / 100n, me] });
  await ensureAllowance(w, token, MARGIN, amount);
  await send(w, { chain, account: w.account!, address: MARGIN, abi: marginAbi, functionName: "deposit", args: [me, token, amount] });
  log("ladder_stock", { id: e.id, floors: short, premium: Number(premium) / 1e6, hash: bought.hash });
}

/** Requote one book around the vault's price; with no price, pull its orders. */
async function quoteBook(w: Wallet | undefined, me: Address, state: State, e: Entry, usdc: Address, ending: boolean) {
  const book = e.book as Address;
  const bs = state.books[book] ?? { resting: [] };
  let mint = 0;
  if (!ending) {
    try {
      const p = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "quote", args: [BigInt(e.id), 1000n * 10n ** 18n] });
      mint = Number(p) / 1e6 / 1000;
    } catch (err) {
      log("ladder_no_price", { id: e.id, error: short(err) });
    }
  }
  const live: Resting[] = [];
  let changed = false;
  let tokens = 0;
  let cash = 0;
  for (const o of bs.resting) {
    const [owner, size, , , , price, , isBuy] = await pub.readContract({ address: book, abi: bookAbi, functionName: "s_orders", args: [o.id] });
    if (owner.toLowerCase() !== me.toLowerCase() || size === 0n) {
      changed = true;
      continue;
    }
    if (size.toString() !== o.size) changed = true;
    live.push(o);
    const t = Number(size) / BOOK.sizePrecision;
    if (isBuy) cash += t * (price / PRICE_PRECISION);
    else tokens += t;
  }
  if (w && mint > 0) await stock(w, e, tokens);
  const [freeTok, freeUsd] = await Promise.all([
    pub.readContract({ address: MARGIN, abi: marginAbi, functionName: "getBalance", args: [me, e.token as Address] }),
    pub.readContract({ address: MARGIN, abi: marginAbi, functionName: "getBalance", args: [me, usdc] }),
  ]);
  tokens += Number(freeTok) / 1e18;
  cash = Math.min(cash + Number(freeUsd) / 1e6, CASH_PER_BOOK);
  const want = ladder(mint, BOOK, tokens, cash, QUOTES);
  const pull = !(mint > 0) && live.length > 0;
  if (!(mint > 0) && live.length === 0) return;
  if (!pull && !shouldRequote(bs.mint, mint, changed || live.length !== bs.resting.length, 300)) return;
  log("ladder_quote", { id: e.id, mint, tokens, cash, bids: want.bids.length, asks: want.asks.length, pull });
  if (!w) return;
  const { hash, receipt } = await send(w, {
    chain,
    account: w.account!,
    address: book,
    abi: bookAbi,
    functionName: "batchUpdate",
    args: [want.bids.map((l) => l.price), want.bids.map((l) => l.size), want.asks.map((l) => l.price), want.asks.map((l) => l.size), live.map((o) => o.id), true],
  });
  const placed: Resting[] = [];
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== book.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: bookAbi, data: l.data, topics: l.topics });
      if (ev.eventName === "OrderCreated" && ev.args.owner.toLowerCase() === me.toLowerCase()) placed.push({ id: ev.args.orderId, size: ev.args.size.toString() });
    } catch {
      /* another event */
    }
  }
  state.books[book] = nextState(bs, live, true, placed, mint > 0 ? mint : undefined);
  save(state);
  log("ladder_requote", { id: e.id, hash, cancelled: live.length, placed: placed.length, mint });
}

async function cycle(w: Wallet | undefined, me: Address, marketId: bigint, usdc: Address, priceSource: Address) {
  const state = load();
  const now = Math.floor(Date.now() / 1000);

  // 1. ended floors: pull their orders, then settle
  for (const e of toSettle(state.entries, now)) {
    try {
      if ((state.books[e.book]?.resting.length ?? 0) > 0) await quoteBook(w, me, state, e, usdc, true);
      if (!w) continue;
      const s = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "getSeries", args: [BigInt(e.id)] });
      if (!s.settled) {
        const { hash } = await send(w, { chain, account: w.account!, address: VAULT, abi: vaultAbi, functionName: "settle", args: [BigInt(e.id)] });
        log("ladder_settle", { id: e.id, hash });
      }
      e.settled = true;
      save(state);
    } catch (err) {
      log("ladder_error", { step: "settle", id: e.id, error: short(err) });
      // past the settle window only the owner can settle; stop retrying after a day
      if (now - e.expiry > 86_400) {
        e.settled = true;
        save(state);
      }
    }
  }

  // 2. open what the ladder is missing, at today's price
  const need = missing(state.entries, now, SLOTS);
  if (need.length) {
    const [spot6] = await pub.readContract({ address: priceSource, abi: priceAbi, functionName: "price", args: [marketId] });
    log("ladder_plan", { spot: Number(spot6) / 1e6, open: need.map((s) => `${s.days}d ${s.pct}%`) });
    if (w) {
      for (const s of need) {
        try {
          await open(w, state, marketId, usdc, Number(spot6), s.days, s.pct, now);
        } catch (err) {
          log("ladder_error", { step: "open", slot: `${s.days}d ${s.pct}%`, error: short(err) });
        }
      }
    }
  }

  // 3. quote every live floor
  for (const e of quotable(state.entries, now)) {
    try {
      await quoteBook(w, me, state, e, usdc, false);
    } catch (err) {
      log("ladder_error", { step: "quote", id: e.id, error: short(err) });
    }
  }
}

async function main() {
  initLog("logs");
  const key = env("KEEPER_PRIVATE_KEY") as Hex;
  if (!key) throw new Error("KEEPER_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(key);
  const w = TRADING ? createWalletClient({ account, chain, transport: http(RPC) }) : undefined;
  const usdc = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "asset" });
  const priceSource = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "priceSource" });
  const first = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "getSeries", args: [0n] });
  const marketId = first.marketId;
  log("ladder_mode", { vault: VAULT, registry: REGISTRY, maker: account.address, trading: TRADING, everyMs: EVERY_MS, level: LEVEL });
  if (w) {
    // one standing allowance each: USDC to the vault (minting stock) and to Kuru's margin account (bids)
    await ensureAllowance(w, usdc, VAULT, 10n ** 12n);
    await ensureAllowance(w, usdc, MARGIN, 10n ** 12n);
    const inMargin = await pub.readContract({ address: MARGIN, abi: marginAbi, functionName: "getBalance", args: [account.address, usdc] });
    const want = BigInt(Number(env("LADDER_MARGIN_USDC", "150")) * 1e6);
    const wallet = await pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    const top = want > inMargin ? want - inMargin : 0n;
    if (top > 0n && wallet >= top) {
      const { hash } = await send(w, { chain, account: w.account!, address: MARGIN, abi: marginAbi, functionName: "deposit", args: [account.address, usdc, top] });
      log("ladder_cash", { usdc: Number(top) / 1e6, hash });
    }
  }
  for (;;) {
    try {
      await cycle(w, account.address, marketId, usdc, priceSource);
    } catch (err) {
      log("ladder_error", { step: "cycle", error: short(err) });
    }
    if (env("KURU_ONCE") === "1") return;
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}
main();
