/** L2 book for one market, in Perpl's scaled integer units. Levels with o == 0 are removed. */
export interface Level {
  p: number;
  s: number;
  o: number;
}

export class Book {
  bids = new Map<number, Level>();
  asks = new Map<number, Level>();
  block = 0;

  snapshot(bid: Level[], ask: Level[], block: number) {
    this.bids = new Map(bid.filter((l) => l.o > 0).map((l) => [l.p, l]));
    this.asks = new Map(ask.filter((l) => l.o > 0).map((l) => [l.p, l]));
    this.block = block;
  }

  update(bid: Level[] = [], ask: Level[] = [], block: number) {
    for (const l of bid) l.o === 0 ? this.bids.delete(l.p) : this.bids.set(l.p, l);
    for (const l of ask) l.o === 0 ? this.asks.delete(l.p) : this.asks.set(l.p, l);
    this.block = block;
  }

  sortedBids(): Level[] {
    return [...this.bids.values()].sort((a, b) => b.p - a.p);
  }

  sortedAsks(): Level[] {
    return [...this.asks.values()].sort((a, b) => a.p - b.p);
  }

  bestBid(): number | undefined {
    return this.sortedBids()[0]?.p;
  }

  bestAsk(): number | undefined {
    return this.sortedAsks()[0]?.p;
  }
}

/**
 * Walk one side of the book for `size` lots, never past `limit`.
 * Returns the fillable size and its volume-weighted price, both in scaled units.
 */
export function walk(levels: Level[], size: number, limit: number, side: "sell" | "buy") {
  let filled = 0;
  let notional = 0;
  for (const l of levels) {
    if (side === "sell" ? l.p < limit : l.p > limit) break;
    const take = Math.min(l.s, size - filled);
    filled += take;
    notional += take * l.p;
    if (filled >= size) break;
  }
  return { filled, vwap: filled > 0 ? notional / filled : 0 };
}
