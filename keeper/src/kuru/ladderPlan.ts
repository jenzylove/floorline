/**
 * Which floors the Kuru ladder should have open right now. Pure, so it is tested without a chain.
 *
 * The ladder is a fixed set of slots: a floor some percent under MON's price, ending in one day or one
 * week. Each slot always has a live series with its own Kuru book. When a slot's series gets close to its
 * end, a new one opens at today's price, so the ladder follows MON and never runs dry.
 */
export interface Slot {
  days: 1 | 7; // tenor
  pct: number; // floor as a percent of MON's price when the series opens
}

export interface Entry {
  id: number; // vault series id
  token: string;
  book: string;
  strike: number; // 6 decimals, as the vault stores it
  expiry: number; // unix seconds
  days: 1 | 7;
  pct: number;
  settled?: boolean;
}

export const SLOTS: Slot[] = [
  { days: 1, pct: 97 },
  { days: 1, pct: 94 },
  { days: 1, pct: 90 },
  { days: 7, pct: 95 },
  { days: 7, pct: 90 },
  { days: 7, pct: 85 },
];

const DAY = 86_400;

/** Series end at midnight UTC: a one day floor at least 12 hours out, a week floor six or seven days out. */
export function expiryFor(days: 1 | 7, now: number): number {
  const nextMidnight = Math.ceil((now + 1) / DAY) * DAY;
  if (days === 1) return nextMidnight - now >= 12 * 3600 ? nextMidnight : nextMidnight + DAY;
  return nextMidnight + 6 * DAY;
}

/** How long before its end a series stops counting as the slot's live floor, so the next one opens. */
export const rollBefore = (days: 1 | 7) => (days === 1 ? 2 * 3600 : DAY);

/** Strike in 6 decimals, rounded down to a clean 0.00001. */
export function strikeFor(spot6: number, pct: number): number {
  return Math.floor((spot6 * pct) / 100 / 10) * 10;
}

/** The slots that have no live series and need a new one. */
export function missing(entries: Entry[], now: number, slots: Slot[] = SLOTS): Slot[] {
  return slots.filter((s) => !entries.some((e) => e.days === s.days && e.pct === s.pct && e.expiry - now > rollBefore(s.days)));
}

/** Series that have ended and still need settling (the vault lets anyone settle in the window after expiry). */
export const toSettle = (entries: Entry[], now: number) => entries.filter((e) => !e.settled && e.expiry <= now);

/** Series still worth quoting: not ended. */
export const quotable = (entries: Entry[], now: number) => entries.filter((e) => e.expiry > now + 60);
