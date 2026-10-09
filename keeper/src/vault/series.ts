/**
 * Rolling series. The keeper keeps a standing menu of protection open so the app always has something to
 * buy: each plan entry is a tenor and a floor relative to the current price (1.0 = at today's price,
 * 0.9 = 10% below). When no open series matches an entry with enough time left, the keeper creates one.
 */
export interface PlanEntry {
  tenorSec: number;
  moneyness: number; // strike / spot
}

export interface OpenSeries {
  strike: number; // AUSD per unit, 6 dp integer
  expiry: number; // unix seconds
  createdAt: number; // unix seconds
}

/** "1d:1.00,1d:0.90,7d:0.90" -> entries. Units: m, h, d. */
export function parsePlan(s: string): PlanEntry[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [t, m] = x.split(":");
      const n = Number(t.slice(0, -1));
      const unit = t.slice(-1);
      const mult = unit === "m" ? 60 : unit === "h" ? 3600 : unit === "d" ? 86400 : NaN;
      const tenorSec = n * mult;
      const moneyness = Number(m);
      if (!Number.isFinite(tenorSec) || tenorSec <= 0 || !(moneyness > 0 && moneyness <= 1.5)) throw new Error(`bad series plan entry "${x}"`);
      return { tenorSec, moneyness };
    });
}

/**
 * Strikes snap to a grid of 0.5% of spot so repeated runs produce the same strikes, not a new series per
 * price tick. Returns the entries that need a new series now.
 */
export function seriesToCreate(plan: PlanEntry[], open: OpenSeries[], spot6: number, nowSec: number): { strike: number; expiry: number }[] {
  const out: { strike: number; expiry: number }[] = [];
  for (const e of plan) {
    // an entry is covered by an open series of the same tenor whose strike is within 2% of the target
    // and that still has at least a third of its tenor left
    const target = spot6 * e.moneyness;
    const covered = open.some(
      (s) =>
        Math.abs(s.expiry - s.createdAt - e.tenorSec) <= e.tenorSec * 0.05 + 120 &&
        Math.abs(s.strike - target) <= target * 0.02 &&
        s.expiry - nowSec >= e.tenorSec / 3,
    );
    if (covered) continue;
    const grid = Math.max(1, Math.round(spot6 * 0.005));
    const strike = Math.max(grid, Math.round(target / grid) * grid);
    out.push({ strike, expiry: nowSec + e.tenorSec + 60 });
  }
  return out;
}
