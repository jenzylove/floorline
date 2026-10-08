import { describe, expect, it } from "vitest";
import { nextVol, realizedVol, volToWad } from "../src/vol.js";
import { withinOracleBand } from "../src/vault/onchain.js";

describe("pricing vol the keeper posts", () => {
  it("stays inside the absolute bounds", () => {
    expect(nextVol(9, undefined, 5000)).toBe(5);
    expect(nextVol(0.01, undefined, 5000)).toBe(0.1);
  });
  it("walks toward a far value within the on-chain step limit, with margin", () => {
    // previous 2.5, measured 0.5, step 50% => at most 45% per post (10% margin)
    expect(nextVol(0.5, 2.5, 5000)).toBeCloseTo(1.375, 9);
    expect(nextVol(9, 2.5, 5000)).toBeCloseTo(3.625, 9);
    expect(nextVol(2.6, 2.5, 5000)).toBeCloseTo(2.6, 9);
  });
  it("encodes exactly", () => {
    expect(volToWad(2.551533)).toBe(2_551_533_000_000_000_000n);
  });
  it("fails closed without enough candles", () => {
    expect(realizedVol([{ t: 0, c: 1 }, { t: 1, c: 2 }], 300)).toBeUndefined();
  });
});

describe("oracle band check before a vault hedge", () => {
  const oracle = 30_000;
  it("allows opening a short at or above oracle minus the band", () => {
    expect(withinOracleBand(true, 29_400, oracle, 200)).toBe(true);
    expect(withinOracleBand(true, 29_399, oracle, 200)).toBe(false);
  });
  it("allows closing at or below oracle plus the band", () => {
    expect(withinOracleBand(false, 30_600, oracle, 200)).toBe(true);
    expect(withinOracleBand(false, 30_601, oracle, 200)).toBe(false);
  });
});
