import { type Level, walk } from "../perpl/book.js";

export interface MarketSpec {
  id: number;
  priceDecimals: number;
  sizeDecimals: number;
}

export interface Risk {
  deadbandPct: number;
  minOrderLots: number;
  maxOrderNotional: number;
  maxPositionNotional: number;
  maxSlippageBps: number;
}

export type Decision =
  | { kind: "hold"; reason: string; targetLots: number; currentLots: number }
  | {
      kind: "order";
      side: "openShort" | "closeShort";
      lots: number;
      limitPrice: number; // scaled
      expectedVwap: number; // scaled
      targetLots: number;
      currentLots: number;
      clamped: boolean;
    };

/**
 * Decide the next hedge order for one market.
 * @param targetUnits short size wanted, in whole units of the underlying (e.g. MON)
 * @param currentLots current short size in Perpl lots
 * @param mark mark price, scaled
 */
export function decide(
  m: MarketSpec,
  risk: Risk,
  targetUnits: number,
  currentLots: number,
  mark: number,
  bids: Level[],
  asks: Level[],
  allowOpen: boolean,
): Decision {
  const lotsPerUnit = 10 ** m.sizeDecimals;
  const priceUnit = 10 ** m.priceDecimals;

  let targetLots = Math.max(0, Math.round(targetUnits * lotsPerUnit));
  let clamped = false;
  const maxLots = Math.floor((risk.maxPositionNotional / (mark / priceUnit)) * lotsPerUnit);
  if (targetLots > maxLots) {
    targetLots = maxLots;
    clamped = true;
  }

  const diff = targetLots - currentLots;
  const band = Math.max(risk.minOrderLots, Math.round(targetLots * risk.deadbandPct));
  if (Math.abs(diff) < band) return { kind: "hold", reason: "within deadband", targetLots, currentLots };
  if (diff > 0 && !allowOpen) return { kind: "hold", reason: "opening disabled (equity below floor)", targetLots, currentLots };

  const maxOrderLots = Math.floor((risk.maxOrderNotional / (mark / priceUnit)) * lotsPerUnit);
  const lots = Math.min(Math.abs(diff), maxOrderLots);
  if (lots < risk.minOrderLots) return { kind: "hold", reason: "order below minimum", targetLots, currentLots };

  if (diff > 0) {
    const touch = bids[0]?.p;
    if (touch === undefined) return { kind: "hold", reason: "no bids", targetLots, currentLots };
    const limitPrice = Math.floor(touch * (1 - risk.maxSlippageBps / 10_000));
    const w = walk(bids, lots, limitPrice, "sell");
    if (w.filled < lots) return { kind: "hold", reason: `book too thin: ${w.filled}/${lots} lots within slippage`, targetLots, currentLots };
    return { kind: "order", side: "openShort", lots, limitPrice, expectedVwap: w.vwap, targetLots, currentLots, clamped };
  }

  const touch = asks[0]?.p;
  if (touch === undefined) return { kind: "hold", reason: "no asks", targetLots, currentLots };
  const limitPrice = Math.ceil(touch * (1 + risk.maxSlippageBps / 10_000));
  const w = walk(asks, lots, limitPrice, "buy");
  if (w.filled < lots) return { kind: "hold", reason: `book too thin: ${w.filled}/${lots} lots within slippage`, targetLots, currentLots };
  return { kind: "order", side: "closeShort", lots, limitPrice, expectedVwap: w.vwap, targetLots, currentLots, clamped };
}
