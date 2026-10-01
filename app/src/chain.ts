import { createPublicClient, defineChain, erc20Abi, formatUnits, http, type Address } from "viem";

export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://monadscan.com" } },
});

export const AUSD = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a" as const;
export const client = createPublicClient({ chain: monad, transport: http() });

export async function balances(addr: Address) {
  const [mon, ausd] = await Promise.all([
    client.getBalance({ address: addr }),
    client.readContract({ address: AUSD, abi: erc20Abi, functionName: "balanceOf", args: [addr] }),
  ]);
  return { mon: formatUnits(mon, 18), ausd: formatUnits(ausd, 6) };
}
