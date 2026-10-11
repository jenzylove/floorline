# Security

Floorline holds real AUSD on Monad mainnet, at small size. This page says what the contracts protect, who is trusted with what, what an internal review found, and how to report a problem.

## Report a problem

Open a private report: **Security → Report a vulnerability** on this repository. Please include the contract or file, the steps, and the impact you expect. Do not open a public issue for anything that could move funds.

There is no bounty program. Reports are read and answered by the author.

## What is in scope

| | |
|---|---|
| Contracts | `contracts/src`: `FloorVault`, `HedgedFloorVault`, `VolFeed`, `PerplPriceSource`, `CreReceiver` |
| Mainnet vault | `0x2286f16a97e592D2C90C31e3ae56E3F4A9ec5dB4` (chain 143) |
| Keeper | `keeper/` |
| App and site | `app/`, `web/` |

Out of scope: Perpl, AUSD, Mera, Kuru, Monday Trade, Aurora Intents, Envio and Chainlink themselves. Testnet deployments hold nothing of value.

## Who is trusted with what

**The owner** (`0x1ea5…b0F7`, one key, no timelock, no multisig) can change pricing parameters and guards, enable markets, pause buys, name the keeper, allow short demo series for chosen buyers, settle a series after its public window has passed, and emergency settle after one day. The owner has no function that withdraws locked collateral: a floor's maximum payout is locked when it is bought and is only released by settlement. The one exception to price being set by the oracle is the emergency settle, where the owner supplies the price. It only works on a series that is still unsettled a full day after expiry, so it matters only if both the public and the keeper failed to settle in time.

**The keeper** (`0xE208…1C6E`, a separate key) can post the pricing volatility, open series and place hedge orders through the vault. Each of these is bounded on chain:

* Volatility can move at most 50% of its value per update (`VolFeed.maxStepBps`).
* A hedge order must be priced within 2% of Perpl's oracle (`maxHedgeSlippageBps`) and under the hedge cap.
* Hedge money can only come from assets that are not locked behind floors.

A stolen keeper key can misprice new floors within those bounds until the owner replaces it. It cannot withdraw.

**Chainlink CRE** is an observer only. Its reports are stored as an observed volatility for comparison and never used for pricing. See the first finding below for why.

**Perpl's oracle** sets the settlement price. The vault refuses a price older than 60 seconds or one where mark and oracle differ by more than 1%. If Perpl's oracle is wrong inside those bounds, settlement is wrong.

**Anyone** can settle an expired series during the 120 seconds after expiry. After that only the owner can, and the event is marked `SettledLate`.

## What the internal review found

A review on 4 October 2026 led to a second deployment (v2) on 8 October. The first vault is retired and paused.

| Finding | Fix |
|---|---|
| The CRE receiver could write the pricing volatility, and the CRE simulation forwarder does not verify signatures. Anyone could have set the price input. Shown with a read only call, never exploited. | CRE now writes to a separate observed slot. The keeper is the only pricing updater, and each update is step limited. |
| Settlement could be delayed by whoever benefited from a later price. | A 120 second public window, then owner only, with a late flag and an emergency path after one day. |
| A stale or manipulated price could be used to buy or settle. | Freshness and mark against oracle checks on every priced action. |
| Very short series could be bought right before a known move. | Series under one hour are allowlist only and carry an extra spread. |
| Hedge orders had no price bound. | Limit price must sit within a band around the oracle. |
| Deposits were accepted while the vault's valuation was stale. | Deposits revert unless the valuation is fresh. |

## Known limits

* **No external audit.** 44 unit, fuzz and invariant tests and 6 mainnet fork tests pass. That is not an audit.
* **The live hedge is off chain custody.** The running bot hedges through Perpl's API from the operator's own Perpl account, and the operator sweeps hedge profit and loss to the vault after each cycle. Depositors trust the operator for that sweep. The contract's own hedge path exists and is tested but is not what runs today.
* **One keeper process.** If it stops, hedging and new series stop and the vault carries unhedged risk until it restarts.
* **Open series are not capped.** Vault accounting loops over open series, so a very large number of them would raise gas costs for every action.
* **The app's deposit route passes through a proxy on the site's domain** to reach the 1Click and KyberSwap APIs. The proxy sees quote requests, never keys.
* **Passkeys are device bound.** Losing the phone without a synced passkey loses the account.
