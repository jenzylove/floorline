/**
 * Floors on Kuru Spot V2 (Monad testnet). A floor is an ERC 20 token, so it trades on an order book: here
 * the app reads Kuru's FLOOR/USDC book and buys or sells from the same passkey account, on testnet.
 *
 * Kuru V2 keeps balances in one custody contract (AccountCore). The first trade deposits test USDC there;
 * after that, orders settle inside it. Orders go straight to the market contract.
 */
import { createPublicClient, createWalletClient, defineChain, erc20Abi, fallback, http, maxUint256, parseAbi, type Address, type Hash, type LocalAccount } from "viem";
import { PROXY } from "./chain";

export const KURU = {
  market: "0xFD5d4Ad286C43dBFd2B2A1Ce0db82E6EA6f5aa38" as Address, // FLOOR/USDC, created by Kuru's team
  accountCore: "0xdbaaDe7B42c95399bb1E9614D51B5B9e2cf78038" as Address,
  floor: "0xDE19301578DA357e3D2260c29Dc51cc37621AADd" as Address,
  usdc: "0xA402B424f392EAA05DBc8779e4502A1F6A96fEF1" as Address,
  vault: "0xc8EDB9e8E1E0e30951b14FD8BF45f06A9332F894" as Address,
  explorer: "https://testnet.monadscan.com",
  minOrderUsd: 10, // the market rejects smaller orders
  takerFee: 0.0007,
};
const P = 1e6; // price and size precision on this market

const testnet = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } }, contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } } });
// same second route as mainnet, for phones that cannot reach monad.xyz
const transport = fallback([http("https://testnet-rpc.monad.xyz", { timeout: 8_000, retryCount: 1 }), http(`${PROXY}/rpc-testnet`, { timeout: 15_000, retryCount: 1 })]);
// reads made together go out as one multicall, so a phone stays under the public RPC's rate limit
const client = createPublicClient({ chain: testnet, transport, batch: { multicall: true } });

const marketAbi = parseAbi([
  "function getL2Book(uint256 levels) view returns (uint32[] bidPrices, uint96[] bidSizes, uint32[] askPrices, uint96[] askSizes)",
  "function batch(uint40 userId, (uint8 side, uint96 quantity, uint32 price, uint8 tif, uint8 executionInstruction, uint32 minSizeAfterBlock)[] orders, uint8[] cancelSlotIdxs)",
]);
const coreAbi = parseAbi([
  "function rootAccountIdOf(address) view returns (uint40)",
  "function getBalance(uint40 accountId, address token) view returns (uint256)",
  "function deposit(address rootOwner, address token, uint256 amount)",
  "function withdraw(uint40 rootAccountId, address token, uint256 amount, address recipient)",
]);
const vaultAbi = parseAbi(["function quote(uint256 seriesId, uint256 amount) view returns (uint256)"]);

export type Level = { price: number; size: number };
export type KuruView = {
  bids: Level[];
  asks: Level[];
  mint: number; // what the vault charges to mint one floor
  usdcWallet: number;
  usdcKuru: number;
  floorsKuru: number;
  floorsWallet: number;
  mon: number;
  accountId: number;
};

export async function kuruView(me: Address): Promise<KuruView> {
  const [[bp, bs, ap, as], premium, usdcWallet, floorsWallet, mon, id] = await Promise.all([
    client.readContract({ address: KURU.market, abi: marketAbi, functionName: "getL2Book", args: [8n] }),
    client.readContract({ address: KURU.vault, abi: vaultAbi, functionName: "quote", args: [0n, 1000n * 10n ** 18n] }).catch(() => 0n),
    client.readContract({ address: KURU.usdc, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
    client.readContract({ address: KURU.floor, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
    client.getBalance({ address: me }),
    client.readContract({ address: KURU.accountCore, abi: coreAbi, functionName: "rootAccountIdOf", args: [me] }),
  ]);
  const [usdcKuru, floorsKuru] = id
    ? await Promise.all([
        client.readContract({ address: KURU.accountCore, abi: coreAbi, functionName: "getBalance", args: [id, KURU.usdc] }),
        client.readContract({ address: KURU.accountCore, abi: coreAbi, functionName: "getBalance", args: [id, KURU.floor] }),
      ])
    : [0n, 0n];
  const side = (prices: readonly number[], sizes: readonly bigint[]) => prices.map((p, i) => ({ price: p / P, size: Number(sizes[i]) / P })).filter((l) => l.size > 0);
  return {
    bids: side(bp, bs).sort((a, b) => b.price - a.price),
    asks: side(ap, as).sort((a, b) => a.price - b.price),
    mint: Number(premium) / 1e6 / 1000,
    usdcWallet: Number(usdcWallet) / 1e6,
    usdcKuru: Number(usdcKuru) / 1e6,
    floorsKuru: Number(floorsKuru) / 1e18,
    floorsWallet: Number(floorsWallet) / 1e18,
    mon: Number(mon) / 1e18,
    accountId: Number(id),
  };
}

/**
 * What taking `floors` from one side of the book would do: how many are there to take, what it costs or
 * pays, and the furthest price it has to reach. That last price is the order's limit.
 */
export function planFill(levels: Level[], floors: number): { floors: number; usd: number; limit: number; short: boolean } {
  let left = floors, usd = 0, limit = 0;
  for (const l of levels) {
    if (left <= 0) break;
    const take = Math.min(left, l.size);
    usd += take * l.price;
    limit = l.price;
    left -= take;
  }
  return { floors: floors - Math.max(0, left), usd, limit, short: left > 0 };
}

/** The fewest floors that clear the market's minimum order at this price, rounded up to a tidy number. */
export function minFloors(price: number): number {
  if (!(price > 0)) return 0;
  return Math.ceil((KURU.minOrderUsd * 1.03) / price / 100) * 100;
}

type Step = (label: string, hash?: Hash) => void;
const walletFor = (account: LocalAccount) => createWalletClient({ account, chain: testnet, transport });
const wait = async (hash: Hash) => {
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("reverted");
};

/** Put `amount` of a token (in its own units) from the wallet into the Kuru account, approving once. */
async function fund(account: LocalAccount, token: Address, amount: bigint, label: string, step: Step) {
  const w = walletFor(account);
  const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, KURU.accountCore] });
  if (allowance < amount) {
    step("Allow Kuru to take the payment");
    const h = await w.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [KURU.accountCore, maxUint256], gas: 120_000n });
    step("Allow Kuru to take the payment", h);
    await wait(h);
  }
  step(label);
  const h = await w.writeContract({ address: KURU.accountCore, abi: coreAbi, functionName: "deposit", args: [account.address, token, amount], gas: 500_000n });
  step(label, h);
  await wait(h);
}

/**
 * Buy or sell `floors` on the book right now. The order takes what rests at `price` or better and cancels
 * the rest (immediate or cancel), so nothing is left hanging.
 */
export async function kuruTrade(account: LocalAccount, side: "buy" | "sell", floors: number, price: number, usd: number, v: KuruView, step: Step): Promise<Hash> {
  const qty = BigInt(Math.round(floors * P));
  if (side === "buy") {
    const need = usd * (1 + KURU.takerFee) * 1.01;
    if (v.usdcKuru < need) await fund(account, KURU.usdc, BigInt(Math.ceil((need - v.usdcKuru) * 1e6)), "Move test USDC to Kuru", step);
  } else if (v.floorsKuru < floors) {
    await fund(account, KURU.floor, BigInt(Math.ceil(floors - v.floorsKuru)) * 10n ** 18n, "Move your floors to Kuru", step);
  }
  const id = await client.readContract({ address: KURU.accountCore, abi: coreAbi, functionName: "rootAccountIdOf", args: [account.address] });
  const label = side === "buy" ? "Buy on Kuru" : "Sell on Kuru";
  step(label);
  const hash = await walletFor(account).writeContract({
    address: KURU.market,
    abi: marketAbi,
    functionName: "batch",
    // side 0 buys, 1 sells; tif 1 is immediate or cancel
    args: [id, [{ side: side === "buy" ? 0 : 1, quantity: qty, price: Math.round(price * P), tif: 1, executionInstruction: 0, minSizeAfterBlock: 0 }], []],
    gas: 2_000_000n,
  });
  step(label, hash);
  await wait(hash);
  return hash;
}

// ---- the floor ladder: one Kuru order book per floor, on Kuru's Router (no minimum order) ----------------

/** The registry the ladder bot lists each new floor's book in. */
export const LADDER = "0x9ccFD82dA30022b06bB9325aE22dA02dde5Cb293" as Address;
const LP = 1e8; // ladder books: price in 1e-8 USDC per floor
const LS = 1e6; // and size in 1e-6 floors
const LADDER_FEE = 0.003;

export type Floor = {
  kind: "v2" | "ladder";
  seriesId: number;
  book: Address;
  token: Address;
  strike: number; // dollars per MON
  expiry: number; // unix seconds
  days?: number; // 1 or 7 for ladder floors
  bestAsk?: number;
};

const ladderAbi = parseAbi(["function latest(uint256 n) view returns (uint256[] seriesIds, address[] books)"]);
const seriesAbi = parseAbi([
  "function getSeries(uint256) view returns ((uint256 marketId, uint256 strike, uint64 expiry, bool settled, address token, uint256 locked, uint256 payoutPerToken, uint256 settlePrice, uint256 owed))",
]);
const v1Abi = parseAbi([
  "function getL2Book() view returns (bytes)",
  "function bestBidAsk() view returns (uint256, uint256)",
  "function placeAndExecuteMarketBuy(uint96 _quoteAmount, uint256 _minAmountOut, bool _isMargin, bool _isFillOrKill) payable returns (uint256)",
  "function placeAndExecuteMarketSell(uint96 _size, uint256 _minAmountOut, bool _isMargin, bool _isFillOrKill) payable returns (uint256)",
]);

/** Every floor that trades on Kuru right now: the flagship V2 market first, then the live ladder, soonest first. */
export async function floors(): Promise<Floor[]> {
  const now = Date.now() / 1000;
  const flagship = await client.readContract({ address: KURU.vault, abi: seriesAbi, functionName: "getSeries", args: [0n] });
  const out: Floor[] = [{ kind: "v2", seriesId: 0, book: KURU.market, token: KURU.floor, strike: Number(flagship.strike) / 1e6, expiry: Number(flagship.expiry) }];
  const [ids, books] = await client.readContract({ address: LADDER, abi: ladderAbi, functionName: "latest", args: [24n] });
  const rows = await Promise.all(
    ids.map(async (id, i) => {
      const [s, ba] = await Promise.all([
        client.readContract({ address: KURU.vault, abi: seriesAbi, functionName: "getSeries", args: [id] }),
        client.readContract({ address: books[i], abi: v1Abi, functionName: "bestBidAsk" }).catch(() => [0n, 0n] as const),
      ]);
      const expiry = Number(s.expiry);
      if (s.settled || expiry < now + 300) return undefined;
      const ask = Number(ba[1]) / 1e18;
      const f: Floor = { kind: "ladder", seriesId: Number(id), book: books[i], token: s.token, strike: Number(s.strike) / 1e6, expiry, bestAsk: ask > 0 && ask < 1e6 ? ask : undefined };
      return f;
    }),
  );
  const ladder = rows.filter((r): r is Floor => !!r).sort((a, b) => a.expiry - b.expiry || b.strike - a.strike);
  const span = (f: Floor) => (f.expiry - now < 2 * 86_400 ? 1 : 7);
  return [...out, ...ladder.map((f) => ({ ...f, days: span(f) }))];
}

/** A ladder book's resting orders, read from the chain: block, then (price, size) bids until a zero, then asks. */
function parseBook(raw: `0x${string}`): { bids: Level[]; asks: Level[] } {
  const hex = raw.slice(2);
  const words: bigint[] = [];
  for (let i = 0; i + 64 <= hex.length; i += 64) words.push(BigInt(`0x${hex.slice(i, i + 64)}`));
  const bids: Level[] = [];
  const asks: Level[] = [];
  let i = 1; // word 0 is the block number
  for (; i + 1 < words.length && words[i] !== 0n; i += 2) bids.push({ price: Number(words[i]) / LP, size: Number(words[i + 1]) / LS });
  i += 1;
  for (; i + 1 < words.length && words[i] !== 0n; i += 2) asks.push({ price: Number(words[i]) / LP, size: Number(words[i + 1]) / LS });
  return { bids: bids.sort((a, b) => b.price - a.price), asks: asks.sort((a, b) => a.price - b.price) };
}

/** The same view as the flagship's, for one ladder floor. Ladder trades come straight from the wallet. */
export async function ladderView(me: Address, f: Floor): Promise<KuruView> {
  const [raw, premium, usdcWallet, floorsWallet, mon] = await Promise.all([
    client.readContract({ address: f.book, abi: v1Abi, functionName: "getL2Book" }),
    client.readContract({ address: KURU.vault, abi: vaultAbi, functionName: "quote", args: [BigInt(f.seriesId), 1000n * 10n ** 18n] }).catch(() => 0n),
    client.readContract({ address: KURU.usdc, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
    client.readContract({ address: f.token, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
    client.getBalance({ address: me }),
  ]);
  const { bids, asks } = parseBook(raw);
  return {
    bids,
    asks,
    mint: Number(premium) / 1e6 / 1000,
    usdcWallet: Number(usdcWallet) / 1e6,
    usdcKuru: 0,
    floorsKuru: 0,
    floorsWallet: Number(floorsWallet) / 1e18,
    mon: Number(mon) / 1e18,
    accountId: 0,
  };
}

/** Allow the book to take `amount` of a token from the wallet, once per trade size. */
async function allow(account: LocalAccount, token: Address, spender: Address, amount: bigint, step: Step) {
  const have = await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
  if (have >= amount) return;
  const label = "Allow Kuru to take the payment";
  step(label);
  const h = await walletFor(account).writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] });
  step(label, h);
  await wait(h);
}

/** Take `floors` from a ladder book at market: what rests is filled, the rest is not, nothing is left hanging. */
export async function ladderTrade(account: LocalAccount, f: Floor, side: "buy" | "sell", floors: number, usd: number, step: Step): Promise<Hash> {
  const w = walletFor(account);
  const label = side === "buy" ? "Buy on Kuru" : "Sell on Kuru";
  if (side === "buy") {
    const spend = usd / (1 - LADDER_FEE);
    await allow(account, KURU.usdc, f.book, BigInt(Math.ceil(spend * 1e6)), step);
    step(label);
    const minOut = BigInt(Math.floor(floors * 0.98)) * 10n ** 18n;
    const h = await w.writeContract({ address: f.book, abi: v1Abi, functionName: "placeAndExecuteMarketBuy", args: [BigInt(Math.ceil(spend * LP)), minOut, false, false] });
    step(label, h);
    await wait(h);
    return h;
  }
  await allow(account, f.token, f.book, BigInt(floors) * 10n ** 18n, step);
  step(label);
  const minOut = BigInt(Math.floor(usd * (1 - LADDER_FEE) * 0.97 * 1e6));
  const h = await w.writeContract({ address: f.book, abi: v1Abi, functionName: "placeAndExecuteMarketSell", args: [BigInt(floors) * BigInt(LS), minOut, false, false] });
  step(label, h);
  await wait(h);
  return h;
}
