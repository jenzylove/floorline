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

const testnet = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } } });
// same second route as mainnet, for phones that cannot reach monad.xyz
const transport = fallback([http("https://testnet-rpc.monad.xyz", { timeout: 8_000, retryCount: 1 }), http(`${PROXY}/rpc-testnet`, { timeout: 15_000, retryCount: 1 })]);
const client = createPublicClient({ chain: testnet, transport });

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
export async function kuruTrade(account: LocalAccount, side: "buy" | "sell", floors: number, price: number, v: KuruView, step: Step): Promise<Hash> {
  const qty = BigInt(Math.round(floors * P));
  if (side === "buy") {
    const need = floors * price * (1 + KURU.takerFee) * 1.01;
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
