/**
 * Kuru Spot V2 (Monad testnet): the pieces the maker needs, on top of Kuru's SDK.
 *
 * V2 keeps balances in one custody contract (AccountCore) under a numeric account id. Money is deposited
 * there once; orders reserve from it and fills settle into it. Orders go to the market contract in a batch.
 */
import { createKuruClient } from "@toxicflow-labs/ts-sdk";
import { accountCoreAbi, orderBookAbi } from "@toxicflow-labs/ts-sdk/abi";
import { type Address, type Hex, createPublicClient, createWalletClient, defineChain, erc20Abi, http, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const V2 = {
  rpc: process.env.KURU_RPC_URL ?? "https://testnet-rpc.monad.xyz",
  accountCore: (process.env.KURU_ACCOUNT_CORE ?? "0xdbaaDe7B42c95399bb1E9614D51B5B9e2cf78038") as Address,
  // FLOOR/USDC, created by Kuru's team on 11 Oct 2026 (SpotMarketRegistered in 0xae140900…91f1)
  market: (process.env.KURU_MARKET ?? "0xFD5d4Ad286C43dBFd2B2A1Ce0db82E6EA6f5aa38") as Address,
  vault: (process.env.KURU_VAULT ?? "0xc8EDB9e8E1E0e30951b14FD8BF45f06A9332F894") as Address,
  series: BigInt(process.env.KURU_SERIES ?? "0"),
};

export const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [V2.rpc] } } });
export const pub = createPublicClient({ chain, transport: http(V2.rpc) });

export interface Market {
  base: Address;
  quote: Address;
  baseDecimals: number;
  quoteDecimals: number;
  pricePrecision: number;
  sizePrecision: number;
  tick: number;
  minQuoteNotional: number; // in quote units, e.g. 10 (USDC)
}

export async function readMarket(): Promise<Market> {
  const m = { address: V2.market, abi: orderBookAbi } as const;
  const [base, quote, pp, sp, tick, minN, quoteDecimals] = await Promise.all([
    pub.readContract({ ...m, functionName: "baseToken" }),
    pub.readContract({ ...m, functionName: "quoteToken" }),
    pub.readContract({ ...m, functionName: "pricePrecision" }),
    pub.readContract({ ...m, functionName: "sizePrecision" }),
    pub.readContract({ ...m, functionName: "tickSize" }),
    pub.readContract({ ...m, functionName: "minQuoteNotional" }),
    pub.readContract({ ...m, functionName: "quoteTokenDecimals" }),
  ]);
  const baseDecimals = await pub.readContract({ address: base, abi: erc20Abi, functionName: "decimals" });
  return { base, quote, baseDecimals, quoteDecimals: Number(quoteDecimals), pricePrecision: Number(pp), sizePrecision: Number(sp), tick: Number(tick), minQuoteNotional: Number(minN) / 10 ** Number(quoteDecimals) };
}

export function clients(key: Hex) {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain, transport: http(V2.rpc) });
  const kuru = createKuruClient({ publicClient: pub as never, walletClient: wallet as never, addresses: { accountCore: V2.accountCore } });
  return { account, wallet, kuru };
}

/** The numeric Kuru account of an address, or 0 if it has never deposited. */
export const accountIdOf = (owner: Address) => pub.readContract({ address: V2.accountCore, abi: accountCoreAbi, functionName: "rootAccountIdOf", args: [owner] });

/** Free and reserved balance of a token in a Kuru account, in the token's own units. */
export async function balances(accountId: bigint, token: Address, decimals: number) {
  const [free, reserved] = await Promise.all([
    pub.readContract({ address: V2.accountCore, abi: accountCoreAbi, functionName: "getBalance", args: [Number(accountId), token] }),
    pub.readContract({ address: V2.accountCore, abi: accountCoreAbi, functionName: "getSpotReservedBalance", args: [Number(accountId), token] }),
  ]);
  return { free: Number(free) / 10 ** decimals, reserved: Number(reserved) / 10 ** decimals };
}

/** Move everything of `token` the wallet holds into its Kuru account (approving first if needed). */
export async function depositAll(c: ReturnType<typeof clients>, token: Address): Promise<Hex | undefined> {
  const me = c.account.address;
  const have = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [me] });
  if (have === 0n) return undefined;
  const allowance = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [me, V2.accountCore] });
  if (allowance < have) {
    const h = await c.wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [V2.accountCore, maxUint256], gas: 120_000n });
    await pub.waitForTransactionReceipt({ hash: h });
  }
  const hash = await c.wallet.writeContract({ address: V2.accountCore, abi: accountCoreAbi, functionName: "deposit", args: [me, token, have], gas: 500_000n });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}
