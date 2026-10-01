import { describe, expect, it } from "vitest";
import { clampVol, realizedVol, volToWad } from "../vol";

const candles = (closes: number[]) => closes.map((c, i) => ({ t: i * 300_000, c }));

describe("realizedVol", () => {
  it("is zero for a flat price", () => {
    expect(realizedVol(candles(Array(60).fill(100)), 300)).toBeCloseTo(0, 10);
  });

  it("matches a hand calculation for alternating +1% / -1% closes", () => {
    const closes = [100];
    for (let i = 0; i < 60; i++) closes.push(closes[i] * (i % 2 === 0 ? 1.01 : 0.99));
    const r = [Math.log(1.01), Math.log(0.99)];
    const mean = (r[0] + r[1]) / 2;
    const n = 60;
    const variance = (30 * (r[0] - mean) ** 2 + 30 * (r[1] - mean) ** 2) / (n - 1);
    const expected = Math.sqrt(variance * ((365 * 24 * 3600) / 300));
    expect(realizedVol(candles(closes), 300)).toBeCloseTo(expected, 8);
  });

  it("refuses to answer from too few candles", () => {
    expect(realizedVol(candles([100, 101, 102]), 300)).toBeUndefined();
  });

  it("ignores zero closes instead of producing NaN", () => {
    const v = realizedVol(candles([100, 0, ...Array(40).fill(100).map((x, i) => x + (i % 2))]), 300);
    expect(Number.isFinite(v!)).toBe(true);
  });
});

describe("clampVol and volToWad", () => {
  it("clamps to the VolFeed bounds", () => {
    expect(clampVol(0.01)).toBe(0.1);
    expect(clampVol(9)).toBe(5);
    expect(clampVol(2.5)).toBe(2.5);
  });
  it("encodes 254% as 2.54e18", () => {
    expect(volToWad(2.54)).toBe(2_540_000_000_000_000_000n);
  });
});
