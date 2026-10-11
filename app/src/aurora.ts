import { createWalletClient, maxUint256, parseUnits, type Address, type Hash, type LocalAccount } from "viem";
import { client, monad, transport } from "./chain";
import { ADDR, erc20Abi } from "./contracts";

/**
 * Add money from any chain with Aurora Intents (NEAR Intents 1Click API): the user picks what they pay
 * with and where from, gets a one-time deposit address, sends from their other wallet, and the funds
 * land in their passkey account on Monad. 1Click delivers USDC or MON on Monad (not AUSD), so a second
 * step converts USDC to AUSD on Monad through KyberSwap's router.
 */
// Both go through floorline-app.vercel.app, which forwards to 1click.chaindefuser.com and KyberSwap.
// Some mobile networks cannot resolve chaindefuser.com; the app's own domain always resolves.
const ONECLICK = "https://floorline-app.vercel.app/api/1click";
const KYBER = "https://floorline-app.vercel.app/api/kyber";
const CLIENT_ID = "floorline";

export const MONAD_USDC = "0x754704bc059f8c67012fed69bc8a327a5aafb603" as const;
export const MONAD_ASSET = {
  USDC: "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx",
  MON: "nep245:v2_1.omni.hot.tg:143_11111111111111111111",
} as const;

export type Source = { assetId: string; symbol: string; chain: string; decimals: number; price: number };

const CHAIN_NAME: Record<string, string> = { base: "Base", arb: "Arbitrum", eth: "Ethereum", op: "Optimism", pol: "Polygon", bsc: "BNB Chain", avax: "Avalanche" };

/** Stablecoins on EVM chains the user can pay from (refunds go back to the same EVM address). */
export async function sources(): Promise<Source[]> {
  const res = await fetch(`${ONECLICK}/tokens`);
  if (!res.ok) throw new Error(`1Click tokens HTTP ${res.status}`);
  const all = (await res.json()) as { assetId: string; symbol: string; blockchain: string; decimals: number; price: number }[];
  return all
    .filter((t) => CHAIN_NAME[t.blockchain] && (t.symbol === "USDC" || t.symbol === "USDT"))
    .map((t) => ({ assetId: t.assetId, symbol: t.symbol, chain: CHAIN_NAME[t.blockchain], decimals: t.decimals, price: t.price }))
    .sort((a, b) => a.chain.localeCompare(b.chain) || a.symbol.localeCompare(b.symbol));
}

export type Deposit = {
  depositAddress: string;
  amountIn: string; // formatted, what to send
  amountOut: string; // formatted, what lands on Monad
  timeEstimate: number; // seconds
  deadline: string;
};

/**
 * A live (non-dry) quote: 1Click returns a one-time deposit address on the source chain. Anything sent there
 * is swapped and bridged to `recipient` on Monad; if it cannot complete, it is refunded to `refundTo`.
 */
export async function quoteDeposit(src: Source, receive: keyof typeof MONAD_ASSET, amountOut: number, recipient: Address, refundTo: Address): Promise<Deposit> {
  const decimals = receive === "MON" ? 18 : 6;
  const body = {
    dry: false,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: src.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: MONAD_ASSET[receive],
    amount: parseUnits(amountOut.toFixed(6), decimals).toString(),
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    referral: "floorline",
  };
  const res = await fetch(`${ONECLICK}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json()) as { quote?: { depositAddress: string; amountInFormatted: string; amountOutFormatted: string; timeEstimate: number; deadline: string }; message?: string };
  if (!res.ok || !j.quote?.depositAddress) throw new Error(j.message ?? `1Click quote HTTP ${res.status}`);
  const q = j.quote;
  return { depositAddress: q.depositAddress, amountIn: q.amountInFormatted, amountOut: q.amountOutFormatted, timeEstimate: q.timeEstimate, deadline: q.deadline };
}

export type DepositStatus = { status: string; done: boolean; failed: boolean; destTx?: string };

export async function depositStatus(depositAddress: string): Promise<DepositStatus> {
  const res = await fetch(`${ONECLICK}/status?depositAddress=${depositAddress}`);
  if (!res.ok) throw new Error(`1Click status HTTP ${res.status}`);
  const j = (await res.json()) as { status: string; swapDetails?: { destinationChainTxHashes?: { hash: string }[] } };
  const status = j.status;
  return {
    status,
    done: status === "SUCCESS",
    failed: status === "FAILED" || status === "REFUNDED",
    destTx: j.swapDetails?.destinationChainTxHashes?.[0]?.hash,
  };
}

export const statusText: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen, confirming",
  PROCESSING: "Moving it to Monad",
  SUCCESS: "Arrived on Monad",
  INCOMPLETE_DEPOSIT: "Less than quoted arrived, it will be refunded",
  REFUNDED: "Refunded to your wallet",
  FAILED: "Failed",
};

// ---------------------------------------------------------------- USDC -> AUSD on Monad

export async function usdcBalance(owner: Address): Promise<number> {
  return Number(await client.readContract({ address: MONAD_USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] })) / 1e6;
}

/** Quote a USDC to AUSD swap on Monad (KyberSwap aggregator). */
export async function quoteToAusd(usdc: number): Promise<{ ausd: number; route: unknown; router: Address; via: string }> {
  const amountIn = BigInt(Math.floor(usdc * 1e6)).toString();
  const res = await fetch(`${KYBER}/routes?tokenIn=${MONAD_USDC}&tokenOut=${ADDR.ausd}&amountIn=${amountIn}`, { headers: { "x-client-id": CLIENT_ID } });
  const j = (await res.json()) as { code: number; message: string; data?: { routeSummary: { amountOut: string; route: { exchange: string }[][] }; routerAddress: Address } };
  if (j.code !== 0 || !j.data) throw new Error(j.message || "no route");
  const via = [...new Set(j.data.routeSummary.route.flat().map((h) => h.exchange))].join(", ");
  return { ausd: Number(j.data.routeSummary.amountOut) / 1e6, route: j.data.routeSummary, router: j.data.routerAddress, via };
}

export async function convertToAusd(account: LocalAccount, usdc: number, step: (label: string, hash?: Hash) => void): Promise<Hash> {
  const q = await quoteToAusd(usdc);
  const build = await fetch(`${KYBER}/route/build`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-client-id": CLIENT_ID },
    body: JSON.stringify({ routeSummary: q.route, sender: account.address, recipient: account.address, slippageTolerance: 50 }),
  });
  const b = (await build.json()) as { code: number; message: string; data?: { data: `0x${string}`; routerAddress: Address; gas: string } };
  if (b.code !== 0 || !b.data) throw new Error(b.message || "could not build the swap");

  const wallet = createWalletClient({ account, chain: monad, transport });
  const amountIn = BigInt(Math.floor(usdc * 1e6));
  const allowance = await client.readContract({ address: MONAD_USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, b.data.routerAddress] });
  if (allowance < amountIn) {
    step("Allow USDC");
    const h = await wallet.writeContract({ address: MONAD_USDC, abi: erc20Abi, functionName: "approve", args: [b.data.routerAddress, maxUint256], gas: 100_000n });
    step("Allow USDC", h);
    await client.waitForTransactionReceipt({ hash: h });
  }
  step("Convert to AUSD");
  const hash = await wallet.sendTransaction({ to: b.data.routerAddress, data: b.data.data, gas: BigInt(Math.ceil(Number(b.data.gas) * 1.5)) + 100_000n });
  step("Convert to AUSD", hash);
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`Swap reverted: ${hash}`);
  return hash;
}
