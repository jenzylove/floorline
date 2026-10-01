# Spike: protection tokens on Monday Trade (mainnet), 2026-10-01

Source: Monday Trade Spot integration instructions (mondaytrade.notion.site, "Monday Trade Spot — Integration Instructions (EN)").
Monday Trade Spot is a Uniswap V3 fork with on-chain limit orders placed on ticks. The docs state pool creation is permissionless.

## Mainnet addresses (from the doc, code verified on chain 143)
| Contract | Address |
|---|---|
| Factory | 0xC1e98D0A2a58fB8aBd10ccc30a58efff4080Aa21 |
| Config | 0xdc67221ea8D223E0A1D0948eDeCB634cAF190eC9 |
| SwapRouter | 0xFE951b693A2FE54BE5148614B109E316B567632F |
| NFTPositionManager | 0x68b507BF58ED32173f41FF20aa2494A569daeC44 |
| QuoterV2 | 0xB97eCD41Aef0F842E773C8F9905919cDE49880C9 |
| WMON (router WETH9) | 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A |

Fee tiers and tick spacing: 100→2, 300→6, 500→10, 3000→60, 10000→200. Order taker fee 300 (0.03%), maker fee 0.

## Result on a Monad mainnet fork
1. Ordinary wallet calls `Factory.createPool(protectionToken, AUSD, 3000)`: success (no allowlist).
2. `pool.initialize(sqrtPriceX96)` at ~34,500 protection tokens per AUSD.
3. Seller `SwapRouter.place(...)`: sell 50,000 protection tokens at tick 379380 (~30,000 per AUSD). Order rests.
4. Buyer `SwapRouter.exactInputSingle(AUSD → protection, 2 AUSD)`: receives all 50,000 tokens, pays 1.673633 AUSD; gas 1.31M.
5. `batchGetUserOrderStatus` shows `isFilled = true`; seller `pool.withdraw` receives 1.673130 AUSD.

## Meaning
Protection tokens can have a real mainnet market today without asking anyone. Kuru mainnet market creation remains owner-gated.
Monday Trade is not a Metropolis bounty sponsor, so it strengthens the main track and the Agora app, not a bounty of its own.
