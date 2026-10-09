import { indexer } from "envio";

/**
 * Perpl accounts that hedge a vault. 5374 is the operator account that hedged cycle 1 (v1). The v2
 * vault's own account is added when the vault emits HedgeAccountOpened, so it needs no configuration.
 */
// kept for reference: the operator hedge account
export const STATIC_HEDGE_ACCOUNTS = new Set((process.env.ENVIO_HEDGE_ACCOUNT_IDS ?? "5374").split(",").map((s) => BigInt(s.trim())));

const base = (event: { chainId: number; srcAddress: string; block: { number: number; timestamp: number }; logIndex: number; transaction: { hash: string } }) => ({
  id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
  blockNumber: event.block.number,
  timestamp: event.block.timestamp,
  txHash: event.transaction.hash,
});

const sid = (vault: string, id: bigint) => `${vault.toLowerCase()}_${id}`;

const empty = {
  seriesId: undefined,
  account: undefined,
  amount: undefined,
  premium: undefined,
  collateral: undefined,
  price: undefined,
  payoutPerToken: undefined,
  expiry: undefined,
  token: undefined,
};

indexer.onEvent({ contract: "FloorVault", event: "Deposit" }, async ({ event, context }) => {
  context.VaultEvent.set({ ...base(event), ...empty, vault: event.srcAddress, kind: "deposit", account: event.params.owner, amount: event.params.assets });
});

indexer.onEvent({ contract: "FloorVault", event: "Withdraw" }, async ({ event, context }) => {
  context.VaultEvent.set({ ...base(event), ...empty, vault: event.srcAddress, kind: "withdraw", account: event.params.owner, amount: event.params.assets });
});

indexer.onEvent({ contract: "FloorVault", event: "SeriesCreated" }, async ({ event, context }) => {
  const p = event.params;
  context.Series.set({
    id: sid(event.srcAddress, p.seriesId),
    vault: event.srcAddress,
    seriesId: p.seriesId,
    marketId: p.marketId,
    strike: p.strike,
    expiry: p.expiry,
    token: p.token,
    unitsSold: 0n,
    premiums: 0n,
    settled: false,
    settlePrice: undefined,
    payoutPerToken: undefined,
  });
  context.VaultEvent.set({ ...base(event), ...empty, vault: event.srcAddress, kind: "seriesCreated", seriesId: p.seriesId, price: p.strike, expiry: p.expiry, token: p.token });
});

indexer.onEvent({ contract: "FloorVault", event: "Bought" }, async ({ event, context }) => {
  const p = event.params;
  const s = await context.Series.get(sid(event.srcAddress, p.seriesId));
  if (s) context.Series.set({ ...s, unitsSold: s.unitsSold + p.amount, premiums: s.premiums + p.premium });
  context.VaultEvent.set({
    ...base(event),
    ...empty,
    vault: event.srcAddress,
    kind: "bought",
    seriesId: p.seriesId,
    account: p.receiver,
    amount: p.amount,
    premium: p.premium,
    collateral: p.collateral,
  });
});

indexer.onEvent({ contract: "FloorVault", event: "Settled" }, async ({ event, context }) => {
  const p = event.params;
  const s = await context.Series.get(sid(event.srcAddress, p.seriesId));
  if (s) context.Series.set({ ...s, settled: true, settlePrice: p.price, payoutPerToken: p.payoutPerToken });
  context.VaultEvent.set({ ...base(event), ...empty, vault: event.srcAddress, kind: "settled", seriesId: p.seriesId, price: p.price, payoutPerToken: p.payoutPerToken });
});

indexer.onEvent({ contract: "FloorVault", event: "Redeemed" }, async ({ event, context }) => {
  const p = event.params;
  context.VaultEvent.set({ ...base(event), ...empty, vault: event.srcAddress, kind: "redeemed", seriesId: p.seriesId, account: p.receiver, amount: p.amount, premium: p.paid });
});

indexer.onEvent({ contract: "FloorVault", event: "SettledLate" }, async ({ event, context }) => {
  const p = event.params;
  context.VaultEvent.set({ ...base(event), ...empty, vault: event.srcAddress, kind: "settledLate", seriesId: p.seriesId, account: p.by, token: p.emergency ? "emergency" : "late" });
});

indexer.onEvent({ contract: "FloorVault", event: "HedgeAccountOpened" }, async ({ event, context }) => {
  const p = event.params;
  context.HedgeAccount.set({ id: p.accountId.toString(), owner: event.srcAddress, openedAt: event.block.timestamp });
  context.VaultEvent.set({ ...base(event), ...empty, vault: event.srcAddress, kind: "hedgeAccountOpened", amount: p.amount, account: p.accountId.toString() });
});

const tag = (b: string) => Buffer.from(b.slice(2), "hex").toString("utf8").replace(/\0+$/, "");

indexer.onEvent({ contract: "VolFeed", event: "VolUpdated" }, async ({ event, context }) => {
  const p = event.params;
  context.VolUpdate.set({ ...base(event), feed: event.srcAddress, kind: "pricing", marketId: p.marketId, vol: p.vol, source: tag(p.source) });
});

indexer.onEvent({ contract: "VolFeed", event: "VolObserved" }, async ({ event, context }) => {
  const p = event.params;
  context.VolUpdate.set({ ...base(event), feed: event.srcAddress, kind: "observed", marketId: p.marketId, vol: p.vol, source: tag(p.source) });
});

// Perpl position events are not indexed: Perpl emits them for every account (about 100k a day), which is
// far past the hosted plan's limit for a few dozen hedge fills. /proof reads the hedge account's live
// position straight from Perpl's contract and shows the fill history exported on 9 Oct (web/hedge-fills.json).
