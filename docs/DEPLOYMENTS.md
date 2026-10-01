# Deployments

## Monad mainnet (chain 143), 2026-10-01

Deployer / owner / keeper: `0x1ea5A49DfEda77F014132490e080B458B661b0F7`

| Contract | Address |
|---|---|
| PerplPriceSource | `0xDaa5d2b55a7C9e1e59A9cc86cf07b4a94977B5Ba` |
| VolFeed | `0x57762E9b87b7BB091C1696bc8F55C88694913473` |
| HedgedFloorVault | `0x85c57FEc4c4861B7D3a99D47C5189de62221a748` |

Vault asset: AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`. Perpl exchange `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`.
MON market (Perpl id 10) enabled; params 1000 / 10 / 120 / 1 day / 60.

Deploy tx hashes: PerplPriceSource `0x3a363906…fefd`, VolFeed `0xb1234813…03aa`, HedgedFloorVault `0x46574e0a…5c7d`.

### Chainlink CRE consumer, 2026-10-01

| Contract | Address |
|---|---|
| CreReceiver | `0xA211561BfF51b923CcDfEfdadbc9c376238D697c` |

Trusts the CRE **simulation** forwarder for Monad mainnet (`0x9eF6468C5f37b976E57d52054c693269479A784d`): the workflow is simulated, not deployed.
Authorised as a VolFeed updater. Deploy tx `0x8af139c8…53ed`, setUpdater tx `0x9962d735…060d`.
