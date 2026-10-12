# Security

How Floorline protects funds, who can do what, and how to report a problem.

## Report a problem

Open a private report: **Security → Report a vulnerability** on this repository. Include the contract or file, the steps, and the impact you expect.

## Scope

| | |
|---|---|
| Contracts | `contracts/src`: `FloorVault`, `HedgedFloorVault`, `VolFeed`, `PerplPriceSource`, `CreReceiver` |
| Mainnet vault | `0x2286f16a97e592D2C90C31e3ae56E3F4A9ec5dB4` (chain 143) |
| Keeper, app and site | `keeper/`, `app/`, `web/` |

## How funds are protected

* **Every floor is fully backed.** Its largest possible payout is locked in AUSD when it is bought and released only by settlement. No role can withdraw locked collateral.
* **Prices are checked.** The vault refuses a price older than 60 seconds, or one where Perpl's mark and oracle differ by more than 1%.
* **Settlement is open.** Anyone can settle an expired floor in the 120 seconds after its end date.
* **The hedge stays with the vault.** The vault holds its own Perpl account. Hedge orders must be within 2% of Perpl's oracle, under a size cap, and funded only from assets not locked behind floors.
* **The pricing input is bounded.** Volatility can move at most 50% of its value per update.
* **Deposits wait for a fresh valuation.**

## Roles

| Role | Can do |
|---|---|
| Owner (`0x1ea5…b0F7`) | Set pricing parameters and guards, enable markets, pause buys, name the keeper, settle after the public window. |
| Keeper (`0xE208…1C6E`, a separate key) | Post volatility, open floors and place hedge orders through the vault, each inside the bounds above. It cannot withdraw. |
| Chainlink CRE workflow | Record an observed volatility for comparison. It does not set the price. |
| Anyone | Settle an expired floor in its window. |

## Review and tests

An internal review on 4 October 2026 led to the current deployment, which added the settlement window, the price checks, the volatility step limit, the hedge price band and the separation of the CRE workflow from pricing.

44 unit, fuzz and invariant tests and 6 mainnet fork tests pass on every push. The contracts have not had an external audit.
