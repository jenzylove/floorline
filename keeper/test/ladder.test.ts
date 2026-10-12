import { describe, expect, it } from "vitest";
import { type Entry, SLOTS, expiryFor, missing, quotable, strikeFor, toSettle } from "../src/kuru/ladderPlan.js";

const DAY = 86_400;
const noon = 1_791_800_000 - (1_791_800_000 % DAY) + 12 * 3600; // 12:00 UTC on some day

const entry = (over: Partial<Entry>): Entry => ({ id: 1, token: "0x", book: "0x", strike: 25_000, expiry: noon + DAY, days: 1, pct: 97, ...over });

describe("kuru ladder plan", () => {
  it("a one day floor ends at the next midnight when that is 12 hours or more away", () => {
    expect(expiryFor(1, noon)).toBe(noon + 12 * 3600);
    expect(expiryFor(1, noon + 3600)).toBe(noon + 12 * 3600 + DAY); // 11h left: the midnight after
  });

  it("a week floor ends six days after the next midnight", () => {
    expect(expiryFor(7, noon)).toBe(noon + 12 * 3600 + 6 * DAY);
  });

  it("strikes round down to 0.00001", () => {
    expect(strikeFor(26_457, 97)).toBe(25_660);
    expect(strikeFor(26_457, 85)).toBe(22_480);
  });

  it("an empty ladder needs every slot", () => {
    expect(missing([], noon)).toHaveLength(SLOTS.length);
  });

  it("a slot is covered until its series gets close to the end", () => {
    const live = entry({ expiry: noon + 5 * 3600 });
    expect(missing([live], noon).some((s) => s.days === 1 && s.pct === 97)).toBe(false);
    const ending = entry({ expiry: noon + 3600 }); // under 2 hours left: open the next one
    expect(missing([ending], noon).some((s) => s.days === 1 && s.pct === 97)).toBe(true);
    const weekEnding = entry({ days: 7, pct: 95, expiry: noon + 20 * 3600 }); // under a day left
    expect(missing([weekEnding], noon).some((s) => s.days === 7 && s.pct === 95)).toBe(true);
  });

  it("ended series are settled once and no longer quoted", () => {
    const ended = entry({ expiry: noon - 10 });
    const done = entry({ id: 2, expiry: noon - 10, settled: true });
    const open = entry({ id: 3 });
    expect(toSettle([ended, done, open], noon).map((e) => e.id)).toEqual([1]);
    expect(quotable([ended, done, open], noon).map((e) => e.id)).toEqual([3]);
  });
});
