# Spikes — 30 Sep 2026

## 1. Can a contract own a Perpl account and hedge from it?

- Run: Foundry fork of Monad mainnet at head. A probe contract received 50 AUSD, approved the
  Perpl Exchange (`0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`), called `createAccount(20e6)`, then
  `execOrder` OpenShort on market 10 (MON), 100 lots, IOC, min price 0.020, leverage 1x.
- First attempt reverted `TakerOrderSettlementFailed(..., resultCode 14)` with
  `maxNegPnlCollatBPS = 0`. Setting it to 300 (the market default) filled.
- Output: account id 5370, position type short, 100 lots, entry 30119 (= $0.030119).
- Verdict: **pass.**

## 2. Can we create a Kuru market for our own token?

- Mainnet Router `0xd651346d7c789536ebf06dc72aE3C8502cd695CC.deployProxy` → revert
  `Unauthorized()` (0x82b42900). Owner `0x8B736DCe2071783Fd9DB0a423dad17cc8ed5788b`.
- Testnet Router `0x7EFbE105Ca7415dE98F96622173458ac1c054630.deployProxy` with a test ERC-20 base and
  testnet USDC quote → market deployed at `0xC5D45A58eBfE5E82B81B60d6FD90fcc71d532B4b` (fork).
- Note: the Kuru docs' Router is the older generation. Kuru Spot V2 on testnet uses different
  contracts (spotRouter `0xba24a1042701f06e8F7edCF04389260D1Fa4c697`, a verified-market registry).
- Verdict: **mainnet blocked (Kuru-gated), testnet open on the older Router; V2 still to check.**

## 3. Does Chainlink CRE support Monad?

- docs.chain.link/cre/supported-networks-ts lists Monad (CLI ≥ 1.29.0) and Monad Testnet
  (CLI ≥ 1.30.0).
- Perpl's `getPerpetualInfo` exposes `oraclePNS`, `oracleTimestampSec` and `linkFeedId` on-chain,
  usable as the settlement price.
- Verdict: **pass.**

Code: `spike/test/Spike.t.sol` (throwaway, not part of the product).
