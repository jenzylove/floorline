# Build log

| Date | Commit | What now works |
|---|---|---|
| 2026-09-30 | a1e608b | PRD, plan, checklist; spikes: contract-owned Perpl account shorts 100 MON on a mainnet fork; Kuru mainnet market creation is Kuru-gated, testnet open; CRE supports Monad |
| 2026-09-30 | ad87638 | Phase 1 contracts: protection tokens, FloorVault (ERC-4626 over AUSD), on-chain Black-Scholes premium (within 0.1% of reference), settle + redeem. 23 tests pass incl. 2 invariants over 16,384 random calls: every token stays fully backed |
| 2026-09-30 | (this) | Phase 2: PerplPriceSource (Perpl on-chain oracle, fresh within ~1–45 s on mainnet); HedgedFloorVault owns its Perpl account, funds it only from free assets, keeper can only open/close capped shorts; fork tests on Monad mainnet: buy 10k MON protection (premium $0.279), open hedge, short 1,000 MON at 1x, hedge equity $49.81 of $50 (fees), backing intact. 27 tests pass |
