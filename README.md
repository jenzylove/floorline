<p align="center">
  <img src="docs/media/brand/mark.svg" alt="Floorline" width="84">
</p>

<h1 align="center">Floorline</h1>

<p align="center">
  <b>Protect your MON without selling it.</b><br>
  Pay once, set a floor under your MON until a date you pick. If MON ends below it you are paid the difference in AUSD, and you keep your coins and all the upside.
</p>

<p align="center">
  <a href="https://floorline-app.vercel.app"><img src="https://img.shields.io/badge/live-floorline--app.vercel.app-121410" alt="Live site"></a>
  <a href="https://monadscan.com/address/0x2286f16a97e592D2C90C31e3ae56E3F4A9ec5dB4"><img src="https://img.shields.io/badge/Monad-mainnet%20vault-836EF9" alt="Vault on Monad mainnet"></a>
  <a href="https://github.com/jenzylove/floorline/actions/workflows/ci.yml"><img src="https://github.com/jenzylove/floorline/actions/workflows/ci.yml/badge.svg" alt="Tests"></a>
  <a href="https://floorline-app.vercel.app/proof"><img src="https://img.shields.io/badge/proof-every%20transaction-b8e62e" alt="Proof page"></a>
  <img src="https://img.shields.io/badge/built%20for-Monad%20Metropolis-836EF9" alt="Built for Monad Metropolis">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-121410" alt="MIT license"></a>
</p>

<p align="center">
  <img src="docs/media/hero.png" alt="Floorline landing page" width="100%">
</p>

Built for **Monad Metropolis 2026**, Track 01: Onchain Finance & Trading. Live on Monad mainnet.

## Start here

| | |
|---|---|
| Live site | https://floorline-app.vercel.app |
| Price a floor, no sign up | https://floorline-app.vercel.app/demo |
| Every transaction, linked | https://floorline-app.vercel.app/proof |
| Android app | https://github.com/jenzylove/floorline/releases/latest/download/floorline.apk |
| The vault on Monad mainnet | [`0x2286…5dB4`](https://monadscan.com/address/0x2286f16a97e592D2C90C31e3ae56E3F4A9ec5dB4) |
| Addresses and deploy hashes | [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md) |
| What was built, day by day | [docs/BUILD_LOG.md](docs/BUILD_LOG.md) |
| Security model and known limits | [SECURITY.md](SECURITY.md) |

## The problem

A MON holder who fears a drop has two choices today: sell and lose the upside, or short a perp and risk liquidation and funding. There is no simple way on Monad to pay a small known price and be covered.

## What Floorline does

A floor is a fully backed put on MON, settled in AUSD.

1. **You pay once.** Pick a floor and a date. The vault prices it on chain with Black Scholes from MON's realised volatility. The quote is what you pay.
2. **The payout is locked.** The most the floor could ever pay is locked in AUSD inside the vault the moment you buy. Every floor is backed in full, so a payout can never fail for lack of funds.
3. **The vault hedges itself.** It holds its own Perpl account and shorts MON there to offset the risk it carries. A keeper triggers the orders but can only trade through the vault, inside a price band.
4. **It settles on the date.** Seconds after expiry the floor settles at Perpl's oracle price. Below your floor, you collect the difference.

The other side is the vault. Anyone can deposit AUSD (ERC 4626), back the floors and earn the premiums. Depositors can lose part of their deposit when MON falls hard. The hedge softens that. It does not remove it.

Each floor is an ERC 20 token, so it can be resold before the date.

## A new market on Kuru

A floor is an ERC 20 token, so it can trade on an order book like any other asset. What makes it a real market and not just a listed token is a price both ways:

* The vault will always mint a floor at its own quote. That is the ceiling.
* A keeper (`keeper/src/kuru`) reads that quote and keeps a ladder of asks just under it and bids under the vault's value before its spread, on Kuru's order book.
* When the vault's price moves by more than 1.5%, or an order is filled, the keeper cancels and replaces its orders in one transaction.

So buying a floor on Kuru is never worse than minting one, and a holder can sell before the date.

Why the keeper does not lose money doing this: the vault's mint price is its fair value plus a 10% spread (`spreadBps = 1000`). Asks sit just under the mint price, which is still about 9% above fair value. Bids sit below fair value. So the keeper sells above what a floor is worth and buys back below it, and a test asserts both (`keeper/test/kuru.test.ts`). **It is live on Kuru Spot V2.** Kuru's team created the FLOOR/USDC market on Monad testnet on 11 Oct (`0xFD5d4Ad286C43dBFd2B2A1Ce0db82E6EA6f5aa38`). The keeper posted its quotes there, a second wallet bought 7,000 floors from the best ask, and the keeper replaced its quotes. The live book is on [/proof](https://floorline-app.vercel.app/proof), read from the market contract. Run the maker with `npm run kuru:v2` in `keeper/`. This is testnet, using Kuru's test USDC: Spot V2 is where Kuru asked new markets to be built. An earlier market on Kuru's older Router (`npm run kuru`) was the fallback before the listing.

## The app

<p align="center">
  <img src="docs/media/app.png" alt="Floorline on Android: welcome, set your floor, home, trade" width="100%">
</p>

Sign in with a fingerprint, no seed phrase. Add money from another chain, protect MON in three steps by dragging the floor on the chart, earn from the vault, and trade MON on Perpl from the same account. Light and dark.

Under Trade there is also **Floors on Kuru**: the live FLOOR/USDC order book from Kuru Spot V2, and buy or sell from the same passkey account. That part runs on Monad testnet with test USDC and is labelled so in the app.

## Judge fast path

1. Open [/demo](https://floorline-app.vercel.app/demo). Pick a floor and an amount. The price is read from the mainnet vault every 10 seconds. Drag the slider to see the payout at any MON price.
2. Open [/proof](https://floorline-app.vercel.app/proof). Vault actions, settlements, volatility updates and the live Perpl hedge position, each linked to its transaction.
3. Install the [Android app](https://github.com/jenzylove/floorline/releases/latest/download/floorline.apk). Sign in with a fingerprint, add AUSD, protect MON in three steps, trade MON on Perpl.

<p align="center">
  <img src="docs/media/demo.png" alt="The demo page: a live quote from the vault and the payout at any price" width="100%">
</p>

## Architecture

```mermaid
flowchart TD
    U[Holder<br/>Android app, passkey account] -->|pays premium in AUSD| V[HedgedFloorVault<br/>ERC 4626, Monad mainnet]
    D[Depositor] -->|deposits AUSD, earns premiums| V
    V -->|mints| T[Floor token<br/>ERC 20, one per series]
    P[Perpl<br/>oracle and mark price] -->|price in, settlement price| V
    VF[VolFeed<br/>pricing volatility] -->|Black Scholes input| V
    K[Keeper bot] -->|posts volatility, step limited| VF
    K -->|opens and settles series| V
    K -->|triggers hedge orders, price banded| V
    V -->|shorts MON from its own account| P
    C[Chainlink CRE workflow] -->|observed volatility, never priced| VF
    T -->|resale| M[Monday Trade pool, mainnet<br/>Kuru order book, testnet]
    A[Aurora Intents] -->|deposits from other chains| U
    E[Envio HyperIndex] -->|events| W[Site: /proof and history]
    V --> E

    style V fill:#121410,color:#f4f4ee
    style T fill:#b8e62e,color:#121410
```

```
app/        Expo (React Native) app. Mera passkey account, viem.
web/        Static site: landing, /demo, /proof. Reads the chain directly.
contracts/  Foundry. FloorVault, HedgedFloorVault, VolFeed, PerplPriceSource, CreReceiver.
keeper/     TypeScript bot: hedges on Perpl, posts volatility, opens and settles series.
cre/        Chainlink CRE workflow: observed volatility, and it can settle expired series.
indexer/    Envio HyperIndex config and handlers.
docs/       PRD, plan, build log, deployments, submission checklist.
```

Safety checks in the vault: price freshness, mark against oracle deviation, a settlement window after which only the owner can settle, an emergency settle after one day, a step limit on volatility updates, a slippage bound on hedge orders, and a block on deposits while the valuation is stale.

## Results so far

Three floors with a real buyer have run to their end date. Small numbers, shown as they are.

| Cycle | Floor | Buyer paid | Floor paid the holder | Hedge result | Where the hedge result went |
|---|---|---|---|---|---|
| 1 Oct, first vault | 140 MON at $0.032206, 15 minutes | $0.0071 | $0 (MON ended above) | about −$0.04 | Operator's account |
| 9 Oct, current vault | 150 MON at $0.024338, 1 hour | $0.0243 | $0 (MON ended above) | −$0.0169 | Operator's account |
| **12 Oct, current vault** | **108 MON at $0.02916, 1 hour** | **$0.2082** | **$0.2110 (MON ended at $0.027206, below the floor)** | **+$0.0167** | **The vault's own Perpl account** |

**The 12 Oct floor is the one that paid.** A holder bought protection on 108 MON from the app on a phone, in two purchases. MON ended $0.001954 below the floor, the keeper settled 16 seconds after the end date, and the holder collected $0.211032 in AUSD from the app: buys [`0x943911c6…`](https://monadscan.com/tx/0x943911c6164bd3eb5f243cff071cc661c32131ffaf8bb046200ac86d9962789f) and [`0x6b2bd43f…`](https://monadscan.com/tx/0x6b2bd43f5194ca6aa6469efe1c55ee320ba82eb965dcfa85e7552b46d8cd55c3), settle [`0x30cb6d0c…`](https://monadscan.com/tx/0x30cb6d0cfd724e136cc139b3f7ea938cbb06364cf32a2d3f42cc8fd302d020d5), collect [`0xb381bb34…`](https://monadscan.com/tx/0xb381bb343c3365944bcc766565ddc88e28ad43c246dac803e65e2434be26ceef).

Read it honestly. That floor was created 5% above MON's price on purpose, to show a payout, so it was already "in the money" when bought and its price included the expected payout. The holder paid $0.2082 and collected $0.2110, a gain of under a cent because MON slipped a little further during the hour. It shows the mechanism end to end, not that buying protection makes money.

For depositors, that hour came out ahead: premium in $0.2082, payout out $0.2110, and the vault's own short on Perpl made $0.0167 as MON fell, a net of about +$0.014. It is also the first cycle hedged from the vault's own Perpl account, so the hedge result landed on depositors. In the first two cycles hedging cost more than the premium and the operator absorbed it, because the hedge then ran from the operator's own account. In cycle 1 the price was set from a manual 90% volatility while MON's realised volatility was about 254%, so the floor was sold too cheaply; pricing has used realised volatility since.

Three short cycles are not evidence that the vault earns over time. Hashes for every step are in [docs/BUILD_LOG.md](docs/BUILD_LOG.md).

## Why Monad

* **The whole trade lives on one chain.** Perpl's order book and oracle are contracts on Monad, so the vault reads the price, hedges and settles against the same state, with no bridge and no off chain price feed.
* **Fast blocks make expiry exact.** A floor settled 9 seconds after its expiry on mainnet. The hedge can be adjusted every few blocks for cents.
* **Cheap gas keeps a small floor worth buying.** Volatility is reposted and new series are opened around the clock; on a slow, costly chain that upkeep would cost more than the premiums.
* **Room for the math.** On chain Black Scholes makes the vault 27.4 KB, over Ethereum's contract size limit and well inside Monad's 128 KB.
* **AUSD is native.** Premiums, collateral and payouts are one stable asset that the app can also spend on Perpl.

## What is real, and what is not

Real, on Monad mainnet:

* Vault, pricing, settlement and the rolling series (a day and a week, three floors each).
* Real floors bought, hedged and settled. One full cycle: 30 hedge orders on Perpl, settled 9 seconds after expiry.
* A floor that paid its holder: MON ended below it, it settled 16 seconds after the end date, and the holder collected $0.211 in AUSD from the app.
* The vault hedging itself: its own Perpl account, opened and trading on mainnet.
* A real resale of a floor token on Monday Trade.
* A real deposit from Base through Aurora Intents, converted to AUSD on Monad.
* The mobile app: passkey account, AUSD balance, buy, earn, collect, and Perpl trades from the same account.

Limits you should know:

* **Size is small.** The vault holds a few dollars. This is a working product at demo scale, not a funded one.
* **The hedge moved on chain on 11 Oct.** Until then the bot hedged through Perpl's trading API from the operator's own Perpl account (75+ real fills, listed on /proof), and the operator swept the result to the vault. Since 11 Oct the vault holds its own Perpl account and every hedge order goes through `HedgedFloorVault.hedge`, so the hedge money never leaves the vault. The API path is still in the keeper (`EXECUTION=api`).
* **Chainlink CRE is simulated, not deployed to a DON.** The simulation forwarder does not verify signatures, so CRE reports are recorded as an *observed* volatility for anyone to compare. They never set the price. The keeper posts the pricing volatility, limited to a maximum step per update. The workflow can also settle expired series, but every settlement so far was done by the keeper.
* **Kuru is on testnet.** A floor token has a live two sided market on Kuru Spot V2, created by Kuru's team on 11 Oct, quoted in Kuru's test USDC by a keeper that refills after fills. The floors traded there come from a testnet copy of the vault. There is no Kuru market on mainnet, where market creation is closed.
* **The owner key has real power:** it can change pricing parameters, pause buys and settle late. There is no timelock or multisig yet.
* **The keeper is one process.** If it stops, hedging and new series stop. Anyone can still settle an expired series in its window.
* The contracts have had an internal review only. No external audit.

## What makes it need less trust, in order

1. **Done, 11 Oct:** the hedge runs from a Perpl account the vault owns, not the operator's.
2. **Done:** anyone can settle an expired floor in its window; the keeper is not required.
3. **Next:** the owner key moves to a multisig with a timelock on pricing parameters. Today it is one key.
4. **Next:** a cap on open series and a check that a premium never exceeds the payout, inside the contract.
5. **Next:** the Chainlink CRE workflow deployed to a live network as a second settler and an independent price check, and more than one keeper.

## Track and bounties

| | How Floorline uses it |
|---|---|
| Track 01 | A new primitive for Monad: fully backed downside protection, priced, hedged and settled on chain. |
| Agora | Mobile trading app. Passkey sign in, AUSD balance, floors paid and backed in AUSD, Perpl trades in the app. |
| Perpl | Price, settlement oracle and hedge venue. An automated delta hedging bot: 75+ fills through Perpl's trading API, then moved on chain into a Perpl account the vault owns. The bot reads market data and candles from Perpl's API. |
| Chainlink CRE | A workflow that computes MON's realised volatility from Perpl candles and writes it on chain as an independent check on the pricing input. |
| Kuru | Floors as a new asset class on Kuru Spot V2: the vault mints, prices and settles them, and a keeper makes a two sided market in them on the FLOOR/USDC market Kuru's team created (testnet). |
| Aurora Intents | Add money from Base, Arbitrum, Ethereum and more straight into the Monad account. |
| Mera | The whole account layer. A passkey on the phone, no seed phrase, no extension. |
| Envio | HyperIndex indexes every vault and volatility event for the proof page and history. |

## Mainnet addresses (chain 143)

| Contract | Address |
|---|---|
| HedgedFloorVault | `0x2286f16a97e592D2C90C31e3ae56E3F4A9ec5dB4` |
| VolFeed | `0x1820045B9a1366d7a8aB8715cf9607f0C3635c6d` |
| PerplPriceSource | `0x0E21C63a335344Db44938C02170374302e7b0b77` |
| CreReceiver | `0x25541C105A727BFc266509cCdbA1327F2c0a6895` |
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` |
| Perpl exchange | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` |

Testnet addresses, the retired v1 and all deploy hashes are in [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md).

## Run it

Contracts (needs [Foundry](https://book.getfoundry.sh)):

```sh
git clone --recurse-submodules https://github.com/jenzylove/floorline.git
cd floorline/contracts
forge test --no-match-path "test/fork/*"                                  # 44 unit, fuzz and invariant tests
forge test --fork-url https://rpc.monad.xyz --match-path "test/fork/*"    # 6 tests against live Perpl
```

Keeper:

```sh
cd keeper
npm install
npm test
cp .env.example .env     # fill in the keeper key and vault address
npm start
```

App:

```sh
cd app
npm install
npx expo start
```

Website: static files in `web/`. Serve the folder with any static server.

## Credits

External code: OpenZeppelin Contracts, PRBMath, forge-std, viem, Expo and React Native, the Mera SDK, Envio HyperIndex, the Chainlink CRE SDK, the Kuru SDK, the NEAR Intents 1Click API and the KyberSwap aggregator API. All contracts in `contracts/src` were written for this hackathon.

## AI use

This project was built with heavy use of an AI coding assistant (Claude Code) for code, tests, review and documentation, directed and checked by the author. All mainnet transactions were signed with the author's keys.

## License

MIT. See [LICENSE](LICENSE).

Not investment advice. Floors can expire worthless.
