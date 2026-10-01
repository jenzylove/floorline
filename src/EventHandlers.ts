import { indexer } from "envio";

/** Perpl account(s) that hedge the vault. The bot trades from account 5374 (owner's funded account). */
const HEDGE_ACCOUNTS = new Set((process.env.ENVIO_HEDGE_ACCOUNT_IDS ?? "5374").split(",").map((s) => BigInt(s.trim())));
const SHORT = 1n;

const base = (event: { chainId: number; block: { number: number; timestamp: number }; logIndex: number; transaction: { hash: string } }) => ({
  id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
  blockNumber: event.block.number,
  timestamp: event.block.timestamp,
  txHash: event.transaction.hash,
});

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
  context.VaultEvent.set({ ...base(event), ...empty, kind: "deposit", account: event.params.owner, amount: event.params.assets });
});

indexer.onEvent({ contract: "FloorVault", event: "Withdraw" }, async ({ event, context }) => {
  context.VaultEvent.set({ ...base(event), ...empty, kind: "withdraw", account: event.params.owner, amount: event.params.assets });
});

indexer.onEvent({ contract: "FloorVault", event: "SeriesCreated" }, async ({ event, context }) => {
  const p = event.params;
  context.Series.set({
    id: p.seriesId.toString(),
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
  context.VaultEvent.set({ ...base(event), ...empty, kind: "seriesCreated", seriesId: p.seriesId, price: p.strike, expiry: p.expiry, token: p.token });
});

indexer.onEvent({ contract: "FloorVault", event: "Bought" }, async ({ event, context }) => {
  const p = event.params;
  const s = await context.Series.get(p.seriesId.toString());
  if (s) context.Series.set({ ...s, unitsSold: s.unitsSold + p.amount, premiums: s.premiums + p.premium });
  context.VaultEvent.set({
    ...base(event),
    ...empty,
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
  const s = await context.Series.get(p.seriesId.toString());
  if (s) context.Series.set({ ...s, settled: true, settlePrice: p.price, payoutPerToken: p.payoutPerToken });
  context.VaultEvent.set({ ...base(event), ...empty, kind: "settled", seriesId: p.seriesId, price: p.price, payoutPerToken: p.payoutPerToken });
});

indexer.onEvent({ contract: "FloorVault", event: "Redeemed" }, async ({ event, context }) => {
  const p = event.params;
  context.VaultEvent.set({ ...base(event), ...empty, kind: "redeemed", seriesId: p.seriesId, account: p.receiver, amount: p.amount, premium: p.paid });
});

indexer.onEvent({ contract: "VolFeed", event: "VolUpdated" }, async ({ event, context }) => {
  const p = event.params;
  const source = Buffer.from(p.source.slice(2), "hex").toString("utf8").replace(/\0+$/, "");
  context.VolUpdate.set({ ...base(event), marketId: p.marketId, vol: p.vol, source });
});

// Perpl emits position events for every account; keep only the hedge account's short side.
const keep = (accountId: bigint, positionType: bigint) => HEDGE_ACCOUNTS.has(accountId) && positionType === SHORT;

indexer.onEvent({ contract: "Perpl", event: "PositionOpenedV2" }, async ({ event, context }) => {
  const p = event.params;
  if (!keep(p.accountId, p.positionType)) return;
  context.HedgeFill.set({ ...base(event), accountId: p.accountId, perpId: p.perpId, kind: "opened", lotsBefore: 0n, lotsAfter: p.lotLNS, price: p.pricePNS, realizedPnl: undefined });
});

indexer.onEvent({ contract: "Perpl", event: "PositionIncreasedV2" }, async ({ event, context }) => {
  const p = event.params;
  if (!keep(p.accountId, p.positionType)) return;
  context.HedgeFill.set({ ...base(event), accountId: p.accountId, perpId: p.perpId, kind: "increased", lotsBefore: p.startLotLNS, lotsAfter: p.endLotLNS, price: p.pricePNS, realizedPnl: undefined });
});

indexer.onEvent({ contract: "Perpl", event: "PositionDecreased" }, async ({ event, context }) => {
  const p = event.params;
  if (!keep(p.accountId, p.positionType)) return;
  context.HedgeFill.set({ ...base(event), accountId: p.accountId, perpId: p.perpId, kind: "decreased", lotsBefore: p.startLotLNS, lotsAfter: p.endLotLNS, price: undefined, realizedPnl: p.deltaPnlCNS });
});

indexer.onEvent({ contract: "Perpl", event: "PositionClosed" }, async ({ event, context }) => {
  const p = event.params;
  if (!keep(p.accountId, p.positionType)) return;
  context.HedgeFill.set({ ...base(event), accountId: p.accountId, perpId: p.perpId, kind: "closed", lotsBefore: 0n, lotsAfter: 0n, price: p.pricePNS, realizedPnl: p.deltaPnlCNS });
});
