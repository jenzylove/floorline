import { type Address } from "viem";
import { PROXY, client } from "./chain";
import { ADDR, MON_MARKET, PERPL_API, erc20Abi, perplAbi, priceAbi, vaultAbi, volAbi } from "./contracts";

/** Every number the app shows is read here, live, from Monad mainnet or Perpl's public API. Nothing is cached or made up. */

export type SeriesView = {
  id: number;
  strike: number; // AUSD per MON
  expiry: number; // unix seconds
  settled: boolean;
  token: Address;
  locked: number; // AUSD
  payoutPerToken: number; // AUSD per MON, after settlement
  settlePrice: number;
  shortTenor: boolean;
};

export type Market = { spot: number; spotAt: number; mark: number; vol: number; volAt: number; observedVol: number; observedAt: number };

const n6 = (x: bigint) => Number(x) / 1e6;

export async function market(): Promise<Market> {
  const [[p, pAt], [m], [v, vAt], [ov, ovAt]] = await Promise.all([
    client.readContract({ address: ADDR.priceSource, abi: priceAbi, functionName: "price", args: [BigInt(MON_MARKET)] }),
    client.readContract({ address: ADDR.priceSource, abi: priceAbi, functionName: "mark", args: [BigInt(MON_MARKET)] }),
    client.readContract({ address: ADDR.volFeed, abi: volAbi, functionName: "get", args: [BigInt(MON_MARKET)] }),
    client.readContract({ address: ADDR.volFeed, abi: volAbi, functionName: "getObserved", args: [BigInt(MON_MARKET)] }),
  ]);
  return { spot: n6(p), spotAt: Number(pAt), mark: n6(m), vol: Number(v) / 1e18, volAt: Number(vAt), observedVol: Number(ov) / 1e18, observedAt: Number(ovAt) };
}

export async function allSeries(): Promise<SeriesView[]> {
  const count = Number(await client.readContract({ address: ADDR.vault, abi: vaultAbi, functionName: "seriesCount" }));
  const ids = Array.from({ length: count }, (_, i) => i);
  return Promise.all(
    ids.map(async (id) => {
      const [s, short] = await Promise.all([
        client.readContract({ address: ADDR.vault, abi: vaultAbi, functionName: "getSeries", args: [BigInt(id)] }),
        client.readContract({ address: ADDR.vault, abi: vaultAbi, functionName: "isShortTenor", args: [BigInt(id)] }),
      ]);
      return {
        id,
        strike: n6(s.strike),
        expiry: Number(s.expiry),
        settled: s.settled,
        token: s.token,
        locked: n6(s.locked),
        payoutPerToken: n6(s.payoutPerToken),
        settlePrice: n6(s.settlePrice),
        shortTenor: short,
      };
    }),
  );
}

/** Premium in AUSD for protecting `units` MON, or the reason the vault will not sell right now. */
export async function quote(seriesId: number, units: number): Promise<{ premium: number } | { error: string }> {
  try {
    const q = await client.readContract({ address: ADDR.vault, abi: vaultAbi, functionName: "quote", args: [BigInt(seriesId), unitsToWei(units)] });
    return { premium: n6(q) };
  } catch (e) {
    return { error: explainRevert(e) };
  }
}

export const unitsToWei = (units: number) => BigInt(Math.round(units * 1e6)) * 10n ** 12n;

export type Holding = { series: SeriesView; units: number; payout: number };

export async function holdings(owner: Address, series: SeriesView[]): Promise<Holding[]> {
  const bals = await Promise.all(series.map((s) => client.readContract({ address: s.token, abi: erc20Abi, functionName: "balanceOf", args: [owner] })));
  return series
    .map((s, i) => {
      const units = Number(bals[i]) / 1e18;
      return { series: s, units, payout: s.settled ? units * s.payoutPerToken : 0 };
    })
    .filter((h) => h.units > 0);
}

export type VaultView = { totalAssets: number; locked: number; owed: number; free: number; liability: number; myValue: number; myMaxWithdraw: number; paused: boolean };

export async function vault(owner?: Address): Promise<VaultView> {
  const r = (fn: string, args: unknown[] = []) => client.readContract({ address: ADDR.vault, abi: vaultAbi, functionName: fn as never, args: args as never }) as Promise<bigint | boolean>;
  const [ta, lk, ow, fr, li, paused] = await Promise.all([r("totalAssets"), r("totalLocked"), r("totalOwed"), r("freeAssets"), r("openLiability"), r("buysPaused")]);
  let myValue = 0;
  let myMaxWithdraw = 0;
  if (owner) {
    const shares = (await r("balanceOf", [owner])) as bigint;
    myValue = shares === 0n ? 0 : n6((await r("convertToAssets", [shares])) as bigint);
    myMaxWithdraw = n6((await r("maxWithdraw", [owner])) as bigint);
  }
  return { totalAssets: n6(ta as bigint), locked: n6(lk as bigint), owed: n6(ow as bigint), free: n6(fr as bigint), liability: n6(li as bigint), myValue, myMaxWithdraw, paused: paused as boolean };
}

export async function wallet(owner: Address) {
  const [mon, ausd] = await Promise.all([
    client.getBalance({ address: owner }),
    client.readContract({ address: ADDR.ausd, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
  ]);
  return { mon: Number(mon) / 1e18, ausd: n6(ausd) };
}

// ---------------------------------------------------------------- Perpl

export type PerplAccount = { id: number; balance: number; locked: number; position?: { side: "long" | "short"; lots: number; entry: number; deposit: number; pnl: number } };

export async function perplAccount(owner: Address): Promise<PerplAccount | undefined> {
  const a = await client.readContract({ address: ADDR.perpl, abi: perplAbi, functionName: "getAccountByAddr", args: [owner] });
  if (a.accountId === 0n) return undefined;
  const [p] = await client.readContract({ address: ADDR.perpl, abi: perplAbi, functionName: "getPosition", args: [BigInt(MON_MARKET), a.accountId] });
  const acct: PerplAccount = { id: Number(a.accountId), balance: n6(a.balanceCNS), locked: n6(a.lockedBalanceCNS) };
  if (p.lotLNS > 0n) {
    acct.position = { side: p.positionType === 1 ? "short" : "long", lots: Number(p.lotLNS), entry: n6(p.pricePNS), deposit: n6(p.depositCNS), pnl: n6(p.pnlCNS) };
  }
  return acct;
}

export async function perplMinOpen(): Promise<number> {
  return n6(await client.readContract({ address: ADDR.perpl, abi: perplAbi, functionName: "getMinAccountOpenCNS" }));
}

export type Candle = { t: number; c: number };

/** MON price history from Perpl's public candles (5 minute candles, last `hours`). */
export async function candles(hours = 24, candleSeconds = 300): Promise<Candle[]> {
  const to = Date.now();
  const from = to - hours * 3600 * 1000;
  const path = `/v1/market-data/${MON_MARKET}/candles/${candleSeconds}/${from}-${to}`;
  // direct first, then through the site's proxy for networks that cannot reach Perpl
  const res = await fetch(`${PERPL_API}${path}`).catch(() => fetch(`${PROXY}/perpl${path}`));
  if (!res.ok) throw new Error(`Perpl candles HTTP ${res.status}`);
  const body = (await res.json()) as { d: { t: number; c: number }[] };
  return body.d.filter((d) => d.c > 0).map((d) => ({ t: d.t, c: d.c / 1e6 }));
}

// ---------------------------------------------------------------- errors

const REASONS: Record<string, string> = {
  "0x6fb3b185": "The price feed is catching up. Try again in a few seconds.",
  StalePrice: "The price feed is catching up. Try again in a few seconds.",
  PriceDisagreement: "The market just moved faster than the price feed. Try again in a few seconds.",
  StaleVol: "Pricing is paused until the volatility input refreshes.",
  SeriesClosed: "This protection has stopped selling. It is in its last minute or already expired.",
  RestrictedSeries: "Short demo series are invite only.",
  NotEnoughFreeCollateral: "The vault does not have enough free money to back this much protection right now.",
  PremiumTooHigh: "The price moved while you were confirming. Check the new quote.",
  Paused: "New protection is paused.",
  StaleValuation: "Deposits wait a few seconds while the vault revalues open protection.",
};

export function explainRevert(e: unknown): string {
  const msg = e instanceof Error ? `${e.message} ${(e as { shortMessage?: string }).shortMessage ?? ""}` : String(e);
  for (const [k, v] of Object.entries(REASONS)) if (msg.includes(k)) return v;
  return msg.split("\n")[0].slice(0, 160);
}
