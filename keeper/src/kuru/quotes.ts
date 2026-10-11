/**
 * Two sided quotes for a protection token on Kuru's order book, built around the vault's own price.
 *
 * The vault will always mint a token at `mint` (its quote, spread included). So asks sit just under
 * `mint`: buying on the book is never worse than minting. Bids sit under the vault's value before its
 * spread, so the maker only buys back below what the token is worth to the vault.
 */
export interface Level {
  price: number; // book integer price (price * pricePrecision), on the tick grid
  size: bigint; // book integer size (tokens * sizePrecision)
}

export interface QuoteParams {
  askSteps: number[]; // multipliers of the vault's mint price, ascending, e.g. [0.99, 1.04, 1.1]
  bidSteps: number[]; // multipliers of the vault's value before spread, descending
  sizeTokens: number; // tokens per level
  spreadBps: number; // the vault's own spread, to recover its value from the mint price
}

export interface Book {
  pricePrecision: number;
  sizePrecision: number;
  tick: number;
  minSize: bigint;
}

export const DEFAULTS: QuoteParams = { askSteps: [0.99, 1.04, 1.1], bidSteps: [0.97, 0.92, 0.86], sizeTokens: 250, spreadBps: 1000 };

/** Round to the tick grid: asks up, bids down, so rounding never crosses the intended price. */
function onGrid(raw: number, tick: number, up: boolean): number {
  const n = up ? Math.ceil(raw / tick) : Math.floor(raw / tick);
  return Math.max(tick, n * tick);
}

/**
 * @param mint the vault's price for one token, in quote units (e.g. 0.002014)
 * @param haveTokens tokens free to sell, @param haveQuote quote free to buy with
 */
export function ladder(mint: number, book: Book, haveTokens: number, haveQuote: number, p: QuoteParams = DEFAULTS): { bids: Level[]; asks: Level[] } {
  if (!(mint > 0)) return { bids: [], asks: [] };
  const value = mint / (1 + p.spreadBps / 10_000);
  const size = BigInt(Math.floor(p.sizeTokens * book.sizePrecision));
  if (size < book.minSize) return { bids: [], asks: [] };

  const asks: Level[] = [];
  let tokens = haveTokens;
  for (const m of p.askSteps) {
    if (tokens < p.sizeTokens) break;
    const price = onGrid(mint * m * book.pricePrecision, book.tick, true);
    if (asks.length && price <= asks[asks.length - 1].price) continue;
    asks.push({ price, size });
    tokens -= p.sizeTokens;
  }

  const bids: Level[] = [];
  let quote = haveQuote;
  const lowestAsk = asks.length ? asks[0].price : Infinity;
  for (const m of p.bidSteps) {
    const price = onGrid(value * m * book.pricePrecision, book.tick, false);
    const cost = (price / book.pricePrecision) * p.sizeTokens;
    if (quote < cost) break;
    if (price >= lowestAsk) continue; // never cross our own ask
    if (bids.length && price >= bids[bids.length - 1].price) continue;
    bids.push({ price, size });
    quote -= cost;
  }
  return { bids, asks };
}

export interface Resting {
  id: number;
  size: string; // book integer size when placed
}
export interface MakerState {
  resting: Resting[];
  mint?: number;
}

/**
 * What the maker remembers after a requote transaction. If it reverted, nothing on the book changed:
 * the old orders are still resting at the old price, so the previous state is kept and the next cycle
 * tries again. Only a successful transaction replaces the orders and the price.
 */
export function nextState(prev: MakerState, live: Resting[], ok: boolean, placed: Resting[], mint: number | undefined): MakerState {
  if (!ok) return { resting: live, mint: prev.mint };
  return { resting: placed, mint };
}

/** Requote when the vault's price has moved by more than `bps`, or when a resting order was filled or is gone. */
export function shouldRequote(lastMint: number | undefined, mint: number, restingChanged: boolean, bps = 150): boolean {
  if (lastMint === undefined || restingChanged) return true;
  return Math.abs(mint - lastMint) / lastMint > bps / 10_000;
}
