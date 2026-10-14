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



## v1 retired, 2026-10-08



After the 4 Oct audit: the CRE receiver could write the pricing vol through the CRE simulation forwarder, which

does not verify signatures (finding C1). On v1: `VolFeed.setUpdater(CreReceiver, false)` `0xb3344882…6a08`,

`setBuysPaused(true)` `0x8bad8426…0207`, owner's 4.707114 AUSD withdrawn `0xb96ac1d6…6760`.



## Monad mainnet v2, 2026-10-08



Owner `0x1ea5A49DfEda77F014132490e080B458B661b0F7`. Keeper `0xE2084643331b3061BcC2979B8508E5c63C171C6E` (a separate key).



| Contract | Address | Deploy tx |

|---|---|---|

| PerplPriceSource | `0x0E21C63a335344Db44938C02170374302e7b0b77` | `0xddad2ac2…d271` |

| VolFeed | `0x1820045B9a1366d7a8aB8715cf9607f0C3635c6d` | `0x262ef9e9…ef9a` |

| HedgedFloorVault | `0x2286f16a97e592D2C90C31e3ae56E3F4A9ec5dB4` | `0xaaea9703…baff` |

| CreReceiver | `0x25541C105A727BFc266509cCdbA1327F2c0a6895` | `0x1af895a0…935b` |



Setup (all status 1): keeper is the only VolFeed updater; CreReceiver is an **observer** (its reports are shown, never

priced); pricing vol seeded at 255.1533% from the 1 Oct CRE run `0xc826024a…97eb`; MON enabled; params spread 10%,

premium floor 0.1%, max price age 10 s at deploy (since raised to 60 s; read `maxPriceAge()` on the vault), max vol age 1 day; hedge cap 5,000 MON; owner allowlisted for short demo

series. Vault bytecode is 27.4 KB, above Ethereum's 24 KB but within Monad's 128 KB limit.



## Monad testnet (chain 10143), 2026-10-09: the Kuru Spot V2 leg



Kuru V2 market creation is owner-only (`deploySpotMarket` from any other address reverts `Unauthorized()`), so Kuru lists

our market. Kuru asked for USDC as the quote, so the testnet vault also takes Kuru's testnet USDC

`0xA402B424f392EAA05DBc8779e4502A1F6A96fEF1` (6 decimals, the quote of every Kuru V2 testnet market): protection is

bought and traded with one token. Same contracts as mainnet, priced from Perpl's testnet MON perp (id 64), no Perpl hedge.



| Contract | Address |

|---|---|

| FloorVault | `0xc8EDB9e8E1E0e30951b14FD8BF45f06A9332F894` |

| PerplPriceSource (Perpl testnet `0x1964c32f…80cc`) | `0x57f7b3b5aEf3dFddAc9EbEB573Bd47D1d467DA09` |

| VolFeed | `0xD6e877fC3B73305Ab4cBa694De8522e30237af55` |

| Series 0 protection token (Kuru base) | `0xDE19301578DA357e3D2260c29Dc51cc37621AADd` |



Series 0: MON below $0.0222, expires 31 Oct 2026 00:00 UTC, past the end of judging. Market params asked of Kuru: same as

their MONUSDC (price precision 1e6, size precision 1e6, tick 1); expected price 0.0004 to 0.008 USDC, hard bounds 0 to 0.0222.



A first testnet copy on AUSD (vault `0x85c57FEc…a748`, token `0xEb501529…085C`) is superseded by this one.



## Chainlink CRE on v2, 2026-10-09



Workflow config points at the v2 vault and `CreReceiver` `0x25541C10…6895`, which is a VolFeed observer. Broadcast run

`0x324fb420…4440`: realised vol 112.03% recorded as observed; the keeper's pricing vol is separate.


## Monad testnet, 2026-10-09: Kuru fallback on the older Router

| Contract | Address |
|---|---|
| TestDollar tUSD (testnet only, mintable by the owner) | `0xEB2D8257b186eDeB8B0cBe47A42dC64844E0Bb4E` |
| FloorVault (tUSD collateral) | `0x25541C105A727BFc266509cCdbA1327F2c0a6895` |
| PerplPriceSource (Perpl testnet) | `0x1820045B9a1366d7a8aB8715cf9607f0C3635c6d` |
| Series 0 protection token (MON below $0.0217, 31 Oct) | `0x8FE89ECF1304E36ac908F38d527Ca44956C7F8b8` |
| Kuru order book, protection/tUSD (older Router `0x7EFbE105…4630`) | `0x75E4f0ae3F8C1Be093eFe08818770d034d4103C8` |

Note: some testnet addresses equal mainnet v2 addresses (same deployer and nonce, different chain).

## Monad testnet, 2026-10-11: Kuru Spot V2 market

| | Address |
|---|---|
| FLOOR/USDC market on Kuru Spot V2 (created by Kuru's team, `0xae140900…91f1`) | `0xFD5d4Ad286C43dBFd2B2A1Ce0db82E6EA6f5aa38` |
| Base: series 0 floor token | `0xDE19301578DA357e3D2260c29Dc51cc37621AADd` |
| Quote: Kuru test USDC | `0xA402B424f392EAA05DBc8779e4502A1F6A96fEF1` |
| Vault that mints and prices the floor | `0xc8EDB9e8E1E0e30951b14FD8BF45f06A9332F894` |
| Kuru AccountCore (custody) | `0xdbaaDe7B42c95399bb1E9614D51B5B9e2cf78038` |
| Maker (keeper), Kuru account 13 | `0xE2084643331b3061BcC2979B8508E5c63C171C6E` |

Price precision 1e6, size precision 1e6, tick 1, minimum order 10 USDC, taker fee 0.07%, maker fee 0.04%.

## Monad testnet, 2026-10-12: the floor ladder on Kuru

The keeper keeps six floors open on the testnet vault, each with its own order book on Kuru's Router, and lists every
book in a registry so the app finds them. It opens new floors each day at the current MON price and settles ended ones.

| | Address / hash |
|---|---|
| KuruLadder registry (owner: keeper) | `0x9ccFD82dA30022b06bB9325aE22dA02dde5Cb293` (deploy `0xb0fb90fb…ef59`) |
| Testnet vault keeper set to `0xE208…1C6E` | `0xceebdedb…d8e1` |
| First books (series 1 to 6) | `0x5901BDAB…01FA`, `0x9A1cFD2E…2378`, `0x724262e6…AB0B`, `0x031DD0De…85b0`, `0x806fDD5F…79f0`, `0x691f0577…88dB` |
| A wallet buys 363 floors on the 1 week 95% book | `0x462154a548f1697d75e13a4026cf7ea2aa45705d3e8da89bdcee773443cb30f6` |
| and sells 200 back | `0x4b1563b46b07552f09fdc871f55d27ad211507122964e142052a03fb00a46d2c` |

