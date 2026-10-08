/**
 * Realised volatility from Perpl's public candles. The same maths as the Chainlink CRE workflow
 * (cre/floorline-workflow/vol.ts), so the pricing input the keeper posts and the number the
 * workflow observes can be compared side by side.
 */
export interface Candle {
  t: number; // open time, ms
  c: number; // close price, scaled
}

export const MIN_VOL = 0.1; // VolFeed absolute bounds
export const MAX_VOL = 5;
const YEAR_SECONDS = 365 * 24 * 3600;

export function realizedVol(candles: Candle[], candleSeconds: number, minReturns = 30): number | undefined {
  const closes = candles.map((c) => c.c).filter((c) => c > 0);
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < minReturns) return undefined;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance * (YEAR_SECONDS / candleSeconds));
}

/**
 * The value to post: inside VolFeed's absolute bounds and, when a previous value exists, inside its
 * per-update step limit (with a 10% margin so rounding never trips the on-chain check).
 * A move bigger than the step is reached over several updates.
 */
export function nextVol(measured: number, previous: number | undefined, maxStepBps: number): number {
  let v = Math.min(MAX_VOL, Math.max(MIN_VOL, measured));
  if (previous && previous > 0) {
    const step = (previous * maxStepBps * 0.9) / 10_000;
    v = Math.min(previous + step, Math.max(previous - step, v));
  }
  return v;
}

/** Vol as the integer VolFeed stores (1e18 = 100%), built from 1e-6 steps to stay exact. */
export function volToWad(v: number): bigint {
  return BigInt(Math.round(v * 1e6)) * 10n ** 12n;
}

export async function fetchCandles(apiUrl: string, marketId: number, candleSeconds: number, windowHours: number): Promise<Candle[]> {
  const to = Date.now();
  const from = to - windowHours * 3600 * 1000;
  const res = await fetch(`${apiUrl}/v1/market-data/${marketId}/candles/${candleSeconds}/${from}-${to}`);
  if (!res.ok) throw new Error(`Perpl candles returned HTTP ${res.status}`);
  const body = (await res.json()) as { d: Candle[] };
  return body.d;
}
