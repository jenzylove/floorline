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

import { CycleLedger } from "../src/hedge/sweep.js";

describe("operator sweep ledger", () => {
  it("opens on exposure and closes when flat, owing only profits to the vault", () => {
    const l = new CycleLedger();
    expect(l.observe(0, 0, 10)).toBeUndefined();
    expect(l.open).toBe(false);
    expect(l.observe(120, 0, 10)).toBeUndefined(); // exposure appears: cycle starts at equity 10
    expect(l.observe(120, 100, 9.98)).toBeUndefined(); // hedging, fees paid
    const win = l.observe(0, 0, 10.05);
    expect(win?.hedgePnl).toBeCloseTo(0.05, 9);
    expect(win?.owedToVault).toBeCloseTo(0.05, 9);
    expect(l.open).toBe(false);

    l.observe(50, 0, 10.05);
    const loss = l.observe(0, 0, 10.01);
    expect(loss?.hedgePnl).toBeCloseTo(-0.04, 9);
    expect(loss?.owedToVault).toBe(0); // operator absorbs losses
  });
  it("stays open while a short is still being closed", () => {
    const l = new CycleLedger();
    l.observe(10, 0, 10);
    expect(l.observe(0, 5, 10)).toBeUndefined();
    expect(l.observe(0, 0, 10)).toBeDefined();
  });
});
