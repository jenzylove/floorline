import { createPublicClient, defineChain, erc20Abi, fallback, formatUnits, http, type Address } from "viem";

export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://monadscan.com" } },
});

export const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a" as const;
// Some mobile networks cannot resolve rpc.monad.xyz. The site proxies the same RPC and Perpl's public API,
// so every read and every signed transaction has a second way out.
export const PROXY = "https://floorline-app.vercel.app/api";
export const transport = fallback([http("https://rpc.monad.xyz", { timeout: 8_000, retryCount: 1 }), http(`${PROXY}/rpc`, { timeout: 15_000, retryCount: 1 })]);
export const client = createPublicClient({ chain: monad, transport });

export async function balances(addr: Address) {
  const [mon, ausd] = await Promise.all([
    client.getBalance({ address: addr }),
    client.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
  ]);
  return { mon: formatUnits(mon, 18), ausd: formatUnits(ausd, 6) };
}
