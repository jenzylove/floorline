# Floorline — PRD

Status: LOCKED 2026-09-30. Monad Metropolis, Track 01 (Onchain Finance & Trading).
Deadline: 13 Oct 2026, 11:59 PM ET (14 Oct 03:59 UTC). Target: code freeze 12 Oct.

## One line

Buy protection for your coins: pay a small, fixed amount and your MON, BTC or ETH can't lose
more than you chose until the date you chose. You keep the coins and all the upside.

## Problem

Holding a volatile coin through a bad week has two exits today, and both hurt.

1. **Sell, or set a stop-loss.** A stop sells at the worst moment, a wick can trigger it and the
   price comes back without you, and if the coins are staked the staking stops.
2. **Short a perp against it.** It needs margin set aside, pays funding every interval, can be
   liquidated if the price jumps, and has to be watched. On Perpl, a liquidation also keeps 20% of
   what margin is left ([Perpl docs](https://docs.perpl.xyz/exchange/liquidation.md)).

What holders actually want is insurance: a known cost now, a floor under the value, and nothing to
manage. In traditional and centralized crypto markets that is a put option, and it is one of the
largest markets there is. On Monad it does not exist: there is no options product on Monad and no
options market on Kuru (checked 30 Sep 2026: Metropolis entries, Kuru markets, web search).

Evidence to add during the build (sourced, no invented numbers):
- MON price history and drawdowns from Perpl's own mark price.
- Perpl liquidations and the 20% cut taken, indexed from chain.

## User and front door

User: someone holding MON (or BTC/ETH exposure) on Monad who wants protection for a week without
selling. Secondary user: someone with AUSD who wants to earn by selling that protection.

First ten seconds (mobile app):
1. Sign in with Face ID (Mera passkey). No seed phrase, no extension.
2. AUSD balance at the top. Card below: "What do you want to protect?" with live prices.
3. Protect screen: slide the floor, pick the date, see the cost and the most you can lose. Next to
   it, the same protection done by shorting on Perpl: margin needed, funding, liquidation price.
   Either one can be executed.

## Full scope (one build, nothing deferred silently)

1. **Protection tokens (contracts).** Each series is an ERC-20: underlying (Perpl market id),
   strike, expiry, put only. European, cash-settled in AUSD, fully collateralized: every token in
   circulation has `strike` AUSD locked behind it.
2. **Vault (contracts).** ERC-4626 over AUSD. Writes protection, collects premiums, locks
   collateral per series, pays settlements. Owns its own Perpl account and hedges from it.
   Withdrawals are limited to unlocked AUSD.
3. **Pricing.** Premium computed on-chain (Black-Scholes approximation) from a volatility input
   posted by a Chainlink CRE workflow: Deribit implied volatility for BTC/ETH, realized volatility
   from Perpl's price history for MON. Floor and cap on the input; a stale input stops sales.
4. **Hedging keeper (Perpl API bounty).** Computes the vault's net delta across open series and
   adjusts a short on Perpl from the vault's own account. The keeper role can only open or reduce
   shorts on listed markets within a size cap. It cannot withdraw.
5. **Settlement.** After expiry, anyone can call `settle(series)`. The price is Perpl's on-chain
   oracle price (Chainlink-sourced) with a freshness check. A CRE workflow calls it on schedule.
   Holders redeem tokens for `max(strike - price, 0)` AUSD each; the rest returns to the vault.
6. **Kuru markets.** Each series trades on its own Kuru order book against AUSD, so protection can
   be resold before expiry. The vault can also sell directly.
7. **Mobile app (Expo, React Native).** Mera passkey accounts, AUSD balance, Protect / Earn / Trade
   tabs. Trade tab places perps orders on Perpl directly (Agora requirement).
8. **Funding from anywhere (Aurora Intents).** Deposit from other chains and assets; lands on Monad
   and is swapped to AUSD.
9. **Indexing (Envio).** Series, purchases, settlements, vault history, hedge fills.
10. **Web: landing, /demo (no sign-up), /proof.** /proof lists every live transaction, marked live
    or replay.
11. **Short-dated series** (15 minutes, 1 hour) next to weekly ones, so a full buy → expiry → payout
    cycle can be shown live.

Cut, with reason: calls (protection is the product; calls add a second risk model without a new
user). Mera PRF bounty (no genuine non-wallet use). Privy/Dynamic (clash with Mera, which Agora
requires).

## How each judging criterion is met (5 × 20%)

| Criterion | How |
|---|---|
| Product Quality & Completeness | Real mobile app, real buy → settle → payout on chain, /proof |
| Technical Excellence | Fully collateralized options, on-chain pricing from CRE input, vault-owned Perpl hedge |
| Monad Integration | Kuru and Perpl are both fully on-chain on Monad, so a contract can sell, hedge and settle in one place; cheap per-block hedge updates |
| Track Fit & Problem Relevance | "New asset primitives, market structures" is the track's own wording |
| Innovation & Impact | First options on Monad; first new asset class on Kuru |

## Claims the product will make, and how each is proven

| Claim | Proof |
|---|---|
| Every protection token is fully backed | Invariant test + on-chain view `collateralOf(series) >= supply * strike` |
| The vault hedges itself on Perpl | Vault's Perpl account id and hedge transactions on /proof |
| Settlement uses Perpl's on-chain price | `settle` tx and the oracle value read in the same block |
| Payout is automatic and correct | A live short-dated series: buy tx, settle tx, redeem tx |
| Keeper cannot withdraw | Test: keeper withdraw reverts; mainnet reverted tx linked |
| Price input is not made up | CRE workflow run logs + on-chain update tx |

## What it does not do

- No calls, no American exercise, no margin selling by users.
- No protection on assets Perpl does not price.
- Does not remove all vault risk: the hedge reduces losses, it does not remove them. Shown plainly.
- Not investment advice; no yield is promised.

## Sponsor checklist (becomes docs/SUBMISSION_CHECKLIST.md, ticked only from the live app)

Main submission (all tracks):
- [ ] Public GitHub repo, MIT license, README with setup, attribution of external code, AI-use disclosure
- [ ] Commit history covering the build window
- [ ] Demo video ≤ 3 min, public, product running, Monad interactions visible
- [ ] Contract addresses / tx hashes; deployed to Monad mainnet or testnet
- [ ] Docs: description, architecture, stack, setup

Agora — Best Mobile Trading App (Track 01):
- [ ] Mobile app
- [ ] Authenticates via Mera passkey
- [ ] Holds and displays an AUSD balance
- [ ] Executes trades through Perpl in the app
- [ ] Demo video ≤ 2 min: passkey login, AUSD balance, at least one Perpl trade
- [ ] Write-up of core features

Kuru — Bring New Assets and Markets (Track 01):
- [ ] A new class of tradable markets on Kuru's spot order book
- [ ] The infrastructure that makes them viable (vault, pricing, settlement)

Kuru — Next Consumer Trading App (Track 01):
- [ ] Focused spot trading product routing trades through Kuru's order book

Perpl — Best use of Perpl's API (all tracks):
- [ ] Production-ready automation on Perpl (hedging keeper)

Chainlink — Best workflow with CRE (all tracks):
- [ ] CRE workflow built/simulated/deployed as an orchestration layer (vol input + settlement)

Aurora Intents (all tracks):
- [ ] Any-chain deposit or deposit-and-execute into the app

Mera UX (all tracks):
- [ ] Mera is the entire account layer: no seed phrase, no extension, no custody backend

Envio (all tracks):
- [ ] HyperIndex/HyperSync powering a core feature (history, /proof)

## Open questions

- Kuru mainnet market creation is restricted to Kuru's team (spike 2). Ticket sent 30 Sep.
  Testnet Kuru markets are permissionless (spike 2). Decision: build on testnet Kuru; mainnet
  market if Kuru lists it.
- Perpl testnet uses a test "USD" token, not AUSD. Mainnet Perpl uses AUSD.
- Name: Floorline (chosen 30 Sep). No crypto project found under that name.
