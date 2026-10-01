import { type Address, type PublicClient, parseAbi } from "viem";
import { putDelta } from "../math/bs.js";

const vaultAbi = parseAbi([
  "function activeSeriesIds() view returns (uint256[])",
  "function getSeries(uint256) view returns ((uint256 marketId, uint256 strike, uint64 expiry, bool settled, address token, uint256 locked, uint256 payoutPerToken, uint256 settlePrice, uint256 owed))",
  "function volFeed() view returns (address)",
]);
const erc20Abi = parseAbi(["function totalSupply() view returns (uint256)"]);
const volAbi = parseAbi(["function get(uint256) view returns (uint256 vol, uint256 updatedAt)"]);

export interface SeriesExposure {
  seriesId: number;
  marketId: number;
  strike: number; // AUSD per unit
  expiry: number; // unix seconds
  supplyUnits: number; // units of underlying protected
  delta: number; // vault's long delta per unit (sold put), in [0, 1]
}

/**
 * The vault is short puts, which leaves it long the underlying by (1 - N(d1)) per protected unit.
 * The hedge target is a short of that size.
 */
export async function readExposure(
  client: PublicClient,
  vault: Address,
  spotByMarket: Map<number, number>,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ series: SeriesExposure[]; targetUnits: Map<number, number> }> {
  const ids = (await client.readContract({ address: vault, abi: vaultAbi, functionName: "activeSeriesIds" })) as bigint[];
  const volFeed = (await client.readContract({ address: vault, abi: vaultAbi, functionName: "volFeed" })) as Address;
  const series: SeriesExposure[] = [];
  const targetUnits = new Map<number, number>();
  for (const id of ids) {
    const s = await client.readContract({ address: vault, abi: vaultAbi, functionName: "getSeries", args: [id] });
    const supply = (await client.readContract({ address: s.token, abi: erc20Abi, functionName: "totalSupply" })) as bigint;
    if (supply === 0n) continue;
    const marketId = Number(s.marketId);
    const spot = spotByMarket.get(marketId);
    if (spot === undefined) continue;
    const [volWad] = (await client.readContract({ address: volFeed, abi: volAbi, functionName: "get", args: [s.marketId] })) as [bigint, bigint];
    const strike = Number(s.strike) / 1e6;
    const supplyUnits = Number(supply) / 1e18;
    const delta = -putDelta(spot, strike, Number(s.expiry) - nowSec, Number(volWad) / 1e18);
    series.push({ seriesId: Number(id), marketId, strike, expiry: Number(s.expiry), supplyUnits, delta });
    targetUnits.set(marketId, (targetUnits.get(marketId) ?? 0) + delta * supplyUnits);
  }
  return { series, targetUnits };
}
