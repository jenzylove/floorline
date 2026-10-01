import type { MarketSpec } from "../hedge/policy.js";

export interface MarketContext extends MarketSpec {
  name: string;
  orderTtlBlocks: number;
  maxNegPnlCollatBps: number;
  takerFeeMicros: number;
  isOpen: boolean;
}

/** GET /v1/pub/context: market configuration, read at runtime as Perpl's docs require. */
export async function fetchContext(apiUrl: string): Promise<{ markets: Map<number, MarketContext>; minOpen: bigint }> {
  const res = await fetch(`${apiUrl}/v1/pub/context`);
  if (!res.ok) throw new Error(`context ${res.status}`);
  const ctx = (await res.json()) as {
    instances: { min_account_open_amount: string }[];
    markets: {
      id: number;
      name: string;
      order_ttl_blocks: number;
      order_max_neg_pnl_collat_bps: number;
      config: { is_open: boolean; price_decimals: number; size_decimals: number; taker_fee: number };
    }[];
  };
  const markets = new Map<number, MarketContext>();
  for (const m of ctx.markets) {
    markets.set(m.id, {
      id: m.id,
      name: m.name,
      priceDecimals: m.config.price_decimals,
      sizeDecimals: m.config.size_decimals,
      orderTtlBlocks: m.order_ttl_blocks,
      maxNegPnlCollatBps: m.order_max_neg_pnl_collat_bps,
      takerFeeMicros: m.config.taker_fee,
      isOpen: m.config.is_open,
    });
  }
  return { markets, minOpen: BigInt(ctx.instances[0]?.min_account_open_amount ?? "0") };
}
