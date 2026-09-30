# Floorline — Plan

Window: 30 Sep → 12 Oct 2026 (freeze), submit 13 Oct. Each phase ends with a check that proves it.

## Network decision

- **Mainnet (chain 143) is primary**: real AUSD, real Perpl hedge, CRE on Monad mainnet. Small
  real amounts (budget: ~$100 of AUSD + MON for gas, from the user).
- **Kuru leg on testnet (10143)** until Kuru lists our market on mainnet (their router is
  owner-only on mainnet; permissionless on testnet). If Kuru lists us, move the Kuru leg to mainnet.
- Every screen and /proof labels which network a transaction is on.

## Phases

| # | Days | Phase | Done when (the check) |
|---|---|---|---|
| 0 | 30 Sep–1 Oct | Repo, docs, spikes written up; Kuru V2 testnet check; name check | Repo pushed; `docs/spikes/*` committed |
| 1 | 1–3 Oct | **Core contracts**: series token, vault (ERC-4626), collateral locking, settle, redeem, on-chain premium from a vol input | Foundry unit + invariant tests pass: full backing holds under fuzzing |
| 2 | 3–4 Oct | **Perpl integration**: vault-owned Perpl account, keeper role (open/reduce short only, capped), settlement from Perpl oracle price | Mainnet fork tests pass; keeper-withdraw reverts |
| 3 | 4–5 Oct | **Mainnet deploy + first real cycle**: deploy, seed vault, sell a 15-minute series, hedge, settle, redeem | Five mainnet tx hashes (deposit, buy, hedge, settle, redeem) in BUILD_LOG |
| 4 | 5–6 Oct | **CRE workflow**: vol input (Deribit for BTC/ETH, Perpl realized vol for MON) + scheduled settle | `cre workflow simulate` passes; deployed workflow updates vol on-chain |
| 5 | 5–7 Oct | **Keeper service**: net delta across series, adjusts Perpl short; runs on a schedule with a fallback | 24h of keeper logs + hedge txs on mainnet |
| 6 | 6–7 Oct | **Kuru**: series markets on Kuru (testnet V2), buy/sell protection through the book | A protection token bought and resold on Kuru, tx hashes |
| 7 | 6–9 Oct | **Mobile app (Expo)**: Mera passkey, AUSD balance, Protect / Earn / Trade (Perpl direct), history | App on a real phone: passkey login → buy protection → Perpl trade, recorded |
| 8 | 8–9 Oct | **Envio indexer + web** (landing, /demo, /proof) | /proof shows live data from the indexer |
| 9 | 9 Oct | **Aurora Intents funding** | A deposit from another chain lands as AUSD in the app |
| 10 | 10 Oct | **Design pass** (screens in both themes, shown to the user) | User approves the look |
| 11 | 10–11 Oct | **Release readiness audit**, fixes, secrets scan, repo public | Audit findings resolved or listed in Scope and limits |
| 12 | 11 Oct | **Gate: user approval** of live product + audit | User says go |
| 13 | 12 Oct | Demo videos (2 min Agora, 3 min main), launch reel, README, submission text | Videos public, checklist ticked from the live app |
| 14 | 13 Oct | Submit on hackathon.monad.xyz: Track 01 + bounties | Submission confirmed before 03:59 UTC 14 Oct |

## Risks and unknowns

| Risk | Status |
|---|---|
| Contract can own a Perpl account and trade | **Known** — spike 1 passed on a mainnet fork |
| Perpl order needs `maxNegPnlCollatBPS` set (0 makes taker orders revert) | **Known** — spike 1 |
| Kuru mainnet market creation | **Known blocker** — owner-only; testnet open. Ticket sent |
| Kuru Spot V2 (current generation) market creation on testnet | **Needs a spike** (the open testnet test used the older Router) |
| CRE on Monad | **Known** — listed as supported (mainnet CLI ≥ 1.29, testnet ≥ 1.30) |
| CRE deploy access (may need Chainlink approval) | **Needs a spike** — fallback: simulated workflow + same logic in our keeper, stated honestly |
| Mera passkeys inside an Expo app (PRF support on device) | **Needs a spike** — PREMIA did Expo + Mera on Android, so likely |
| On-chain Black-Scholes cost and accuracy | **Needs a spike** — compare against a reference implementation |
| Deribit API reachable from CRE nodes | **Needs a spike** |
| Aurora Intents: AUSD is not in the 1Click token list; USDC on Monad is | **Known** — deposit lands as USDC, swap to AUSD on Kuru/Monday Trade |
| Vault loss in a crash | **Known** — fully backed so it always pays; hedge reduces loss; shown on Earn tab |
| Mainnet funds needed | **Known** — ask the user for ~$100 AUSD + MON gas before phase 3 |
