/** Pure maths for the workflow, no SDK imports so it can be unit tested. */

export interface Candle {
  t: number; // open time, ms
  c: number; // close price, scaled
}

export const MIN_VOL = 0.1; // VolFeed bounds
export const MAX_VOL = 5;
const YEAR_SECONDS = 365 * 24 * 3600;

/**
 * Realised volatility, annualised, from candle closes: standard deviation of log returns,
 * scaled by sqrt(candles per year). Returns undefined if there are too few usable candles.
 */
export function realizedVol(candles: Candle[], candleSeconds: number, minReturns = 30): number | undefined {
  const closes = candles.map((c) => c.c).filter((c) => c > 0);
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < minReturns) return undefined;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance * (YEAR_SECONDS / candleSeconds));
}

/** Clamp into the range VolFeed accepts. */
export function clampVol(v: number): number {
  return Math.min(MAX_VOL, Math.max(MIN_VOL, v));
}

/** Vol as the integer VolFeed stores (1e18 = 100%). Built from 1e-6 steps to stay exact in bigint. */
export function volToWad(v: number): bigint {
  return BigInt(Math.round(v * 1e6)) * 10n ** 12n;
}
