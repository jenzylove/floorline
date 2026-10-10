# Floorline contracts

Foundry project. Solidity 0.8.30, `via_ir`, EVM version prague.

| Contract | What it does |
|---|---|
| `FloorVault` | ERC 4626 vault in AUSD. Sells fully backed, cash settled puts on MON as ERC 20 series tokens, prices them with Black Scholes, locks the maximum payout, settles at the oracle price. |
| `HedgedFloorVault` | `FloorVault` plus a Perpl account owned by the vault, so the keeper can short MON from free assets within a price band and a cap. |
| `VolFeed` | The pricing volatility (keeper only, step limited) and a separate observed volatility (Chainlink CRE). |
| `PerplPriceSource` | Reads Perpl's oracle and mark price for a market. |
| `CreReceiver` | Receives Chainlink CRE reports: observed volatility, and settle an expired series. |

```sh
forge test --no-match-path "test/fork/*"                                  # unit and invariant tests
forge test --fork-url https://rpc.monad.xyz --match-path "test/fork/*"    # against live Perpl on Monad mainnet
```

The vault is 27.4 KB, above Ethereum's 24 KB limit and within Monad's 128 KB, so deploy scripts need `--disable-code-size-limit`.

Deploy scripts are in `script/`. Addresses and hashes are in [../docs/DEPLOYMENTS.md](../docs/DEPLOYMENTS.md). The trust model is in [../SECURITY.md](../SECURITY.md).
