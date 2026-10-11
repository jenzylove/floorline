import { describe, expect, it } from "vitest";
import { type Book, DEFAULTS, ladder, nextState, shouldRequote } from "../src/kuru/quotes.js";

const book: Book = { pricePrecision: 1_000_000, sizePrecision: 1_000_000, tick: 1, minSize: 10_000n };
const mint = 0.002014; // what the vault charges for one token

describe("kuru ladder", () => {
  it("quotes both sides around the vault's price", () => {
    const { bids, asks } = ladder(mint, book, 1500, 40);
    expect(asks).toHaveLength(3);
    expect(bids).toHaveLength(3);
    expect(asks.map((a) => a.price)).toEqual([1994, 2095, 2216]);
    expect(asks.every((a) => a.size === 250_000_000n)).toBe(true);
  });

  it("the best ask is never above the vault's own price, so the book beats minting", () => {
    const { asks } = ladder(mint, book, 1500, 40);
    expect(asks[0].price).toBeLessThanOrEqual(Math.ceil(mint * book.pricePrecision));
  });

  it("every bid is below the vault's value before its spread", () => {
    const { bids } = ladder(mint, book, 1500, 40);
    const value = (mint / 1.1) * book.pricePrecision;
    expect(bids.every((b) => b.price < value)).toBe(true);
  });

  it("bids and asks never cross", () => {
    const { bids, asks } = ladder(mint, book, 1500, 40);
    expect(Math.max(...bids.map((b) => b.price))).toBeLessThan(Math.min(...asks.map((a) => a.price)));
  });

  it("only sells tokens it has", () => {
    expect(ladder(mint, book, 600, 40).asks).toHaveLength(2);
    expect(ladder(mint, book, 100, 40).asks).toHaveLength(0);
  });

  it("only bids with cash it has", () => {
    const cost = (1776 / 1e6) * DEFAULTS.sizeTokens; // first bid
    expect(ladder(mint, book, 1500, cost * 1.5).bids).toHaveLength(1);
    expect(ladder(mint, book, 1500, 0).bids).toHaveLength(0);
  });

  it("keeps prices on the tick grid and levels distinct on a coarse tick", () => {
    const coarse = { ...book, tick: 100 };
    const { bids, asks } = ladder(mint, coarse, 1500, 40);
    for (const l of [...bids, ...asks]) expect(l.price % 100).toBe(0);
    expect(new Set(asks.map((a) => a.price)).size).toBe(asks.length);
    expect(new Set(bids.map((b) => b.price)).size).toBe(bids.length);
  });

  it("posts nothing without a price", () => {
    expect(ladder(0, book, 1500, 40)).toEqual({ bids: [], asks: [] });
  });
});

describe("maker economics", () => {
  it("every ask is above the vault's value before its spread, so the maker never sells below value", () => {
    const { asks } = ladder(mint, book, 1500, 40);
    const value = (mint / (1 + DEFAULTS.spreadBps / 10_000)) * book.pricePrecision;
    expect(asks.every((a) => a.price > value)).toBe(true);
  });
});

describe("maker state after a requote", () => {
  const prev = { resting: [{ id: 2, size: "250000000" }, { id: 3, size: "250000000" }], mint: 0.002 };
  const placed = [{ id: 9, size: "250000000" }];
  it("a reverted requote keeps the orders still on the book and the old price", () => {
    expect(nextState(prev, prev.resting, false, [], 0.0025)).toEqual(prev);
  });
  it("a successful requote replaces them and takes the new price", () => {
    expect(nextState(prev, prev.resting, true, placed, 0.0025)).toEqual({ resting: placed, mint: 0.0025 });
  });
  it("a successful pull with no vault price leaves nothing resting and no price", () => {
    expect(nextState(prev, prev.resting, true, [], undefined)).toEqual({ resting: [], mint: undefined });
  });
});

describe("requote rule", () => {
  it("requotes on the first run and after a fill", () => {
    expect(shouldRequote(undefined, mint, false)).toBe(true);
    expect(shouldRequote(mint, mint, true)).toBe(true);
  });
  it("holds while the vault's price is within 1.5%", () => {
    expect(shouldRequote(mint, mint * 1.01, false)).toBe(false);
    expect(shouldRequote(mint, mint * 1.02, false)).toBe(true);
    expect(shouldRequote(mint, mint * 0.98, false)).toBe(true);
  });
});
