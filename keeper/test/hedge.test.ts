import { describe, expect, it } from "vitest";
import { putDelta, normCdf } from "../src/math/bs.js";
import { Book, walk } from "../src/perpl/book.js";
import { decide } from "../src/hedge/policy.js";

const MON = { id: 10, priceDecimals: 6, sizeDecimals: 0 };
const risk = { deadbandPct: 0.1, minOrderLots: 1, maxOrderNotional: 10, maxPositionNotional: 9, maxSlippageBps: 50 };
const bids = [
  { p: 30_000, s: 100, o: 1 },
  { p: 29_950, s: 200, o: 1 },
  { p: 29_000, s: 10_000, o: 1 },
];
const asks = [
  { p: 30_050, s: 150, o: 1 },
  { p: 30_100, s: 1_000, o: 1 },
];

describe("black-scholes delta", () => {
  it("matches the normal CDF at known points", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it("is -0.5-ish at the money and bounded", () => {
    const d = putDelta(0.03, 0.03, 7 * 86400, 0.9);
    expect(d).toBeGreaterThan(-0.5);
    expect(d).toBeLessThan(-0.4);
    expect(putDelta(0.03, 0.02, 3600, 0.9)).toBeGreaterThan(-0.001);
  });
  it("is a step at expiry", () => {
    expect(putDelta(0.02, 0.03, 0, 0.9)).toBe(-1);
    expect(putDelta(0.04, 0.03, 0, 0.9)).toBe(0);
  });
});

describe("book", () => {
  it("applies snapshot and removes o=0 levels", () => {
    const b = new Book();
    b.snapshot(bids, asks, 1);
    b.update([{ p: 30_000, s: 0, o: 0 }], [], 2);
    expect(b.bestBid()).toBe(29_950);
    expect(b.bestAsk()).toBe(30_050);
  });
  it("walks within a price limit", () => {
    const w = walk(bids, 250, 29_900, "sell");
    expect(w.filled).toBe(250);
    expect(w.vwap).toBeCloseTo((100 * 30_000 + 150 * 29_950) / 250, 6);
    expect(walk(bids, 400, 29_900, "sell").filled).toBe(300);
  });
});

describe("hedge policy", () => {
  it("opens a short toward the target, capped per order and within slippage", () => {
    const d = decide(MON, risk, 250, 0, 30_000, bids, asks, true);
    expect(d.kind).toBe("order");
    if (d.kind !== "order") return;
    expect(d.side).toBe("openShort");
    expect(d.lots).toBe(250);
    expect(d.limitPrice).toBe(Math.floor(30_000 * 0.995));
  });
  it("holds inside the deadband", () => {
    expect(decide(MON, risk, 250, 240, 30_000, bids, asks, true).kind).toBe("hold");
  });
  it("closes when over-hedged", () => {
    const d = decide(MON, risk, 50, 200, 30_000, bids, asks, true);
    expect(d.kind === "order" && d.side).toBe("closeShort");
  });
  it("caps the total short at the position limit", () => {
    const d = decide(MON, risk, 1_000_000, 0, 30_000, bids, asks, true);
    expect(d.targetLots).toBe(300); // $9 / $0.03
  });
  it("refuses to open when equity is below the floor but still closes", () => {
    expect(decide(MON, risk, 250, 0, 30_000, bids, asks, false).kind).toBe("hold");
    expect(decide(MON, risk, 0, 200, 30_000, bids, asks, false).kind).toBe("order");
  });
  it("holds when the book is too thin inside the slippage bound", () => {
    const thin = [{ p: 30_000, s: 10, o: 1 }];
    expect(decide(MON, risk, 250, 0, 30_000, thin, asks, true).kind).toBe("hold");
  });
});
