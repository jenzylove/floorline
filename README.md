# Floorline

**Protect your MON without selling it.** Pay once, set a floor under your MON until a date you pick. If MON ends below the floor you are paid the difference in AUSD. You keep your coins and all the upside.

Built for Monad Metropolis 2026, Track 01: Onchain Finance & Trading. Live on Monad mainnet.

| | |
|---|---|
| Website | https://floorline-app.vercel.app |
| Price a floor, no sign up | https://floorline-app.vercel.app/demo |
| Every transaction | https://floorline-app.vercel.app/proof |
| Android app | https://expo.dev/accounts/jdollars-team/projects/floorline/builds |
| Addresses and deploy hashes | [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md) |

## The problem

A MON holder who fears a drop has two choices today: sell and lose the upside, or short a perp and risk liquidation and funding. There is no simple way on Monad to pay a small known price and be covered.

## What Floorline does

A floor is a fully backed put on MON, settled in AUSD.

1. **You pay once.** Pick a floor and a date. The vault prices it on chain with Black Scholes from MON's realised volatility. The quote is what you pay.
2. **The payout is locked.** The most the floor could ever pay is locked in AUSD inside the vault the moment you buy. Every floor is backed in full, so a payout can never fail for lack of funds.
3. **The vault hedges.** A keeper shorts MON on Perpl to offset the risk the vault carries.
4. **It settles on the date.** Seconds after expiry the floor settles at Perpl's oracle price. Below your floor, you collect the difference.

The other side is the vault. Anyone can deposit AUSD (ERC 4626), back the floors and earn the premiums. Depositors can lose part of their deposit when MON falls hard. The hedge softens that. It does not remove it.

Each floor is an ERC 20 token, so it can be resold before the date.

## Judge fast path

1. Open [/demo](https://floorline-app.vercel.app/demo). Pick a floor and an amount. The price is read from the mainnet vault every 10 seconds. Drag the slider to see the payout at any MON price.
2. Open [/proof](https://floorline-app.vercel.app/proof). Vault actions, settlements, volatility updates and the live Perpl hedge position, each linked to its transaction.
3. Install the Android app. Sign in with a fingerprint, add AUSD, protect MON in three steps, trade MON on Perpl.

## What is real, and what is not

Real, on Monad mainnet:

* Vault, pricing, settlement and the rolling series (a day and a week, three floors each).
* Real floors bought, hedged and settled. One full cycle: 30 hedge orders on Perpl, settled 9 seconds after expiry.
* A real resale of a floor token on Monday Trade.
* A real deposit from Base through Aurora Intents, converted to AUSD on Monad.
* The mobile app: passkey account, AUSD balance, buy, earn, collect, and Perpl trades from the same account.

Limits you should know:

* **Size is small.** The vault holds a few dollars. This is a working product at demo scale, not a funded one.
* **The hedge runs through Perpl's API from the operator's Perpl account,** not from the vault contract. Hedge profit and loss is swept to the vault by the operator after each cycle, and every sweep is logged. The contract can also hedge by itself (`HedgedFloorVault.hedge`), and that path is tested on a mainnet fork, but the live bot uses the API.
* **Chainlink CRE is simulated, not deployed to a DON.** The simulation forwarder does not verify signatures, so CRE reports are recorded as an *observed* volatility for anyone to compare. They never set the price. The keeper posts the pricing volatility, limited to a maximum step per update.
* **Kuru is on testnet.** A floor token trades on a Kuru order book on Monad testnet with real fills. Kuru Spot V2 market creation is owner only, so that listing depends on Kuru's team.
* **The owner key has real power:** it can change pricing parameters, pause buys and settle late. There is no timelock or multisig yet.
* The contracts have had an internal review only. No external audit.

## Track and bounties

| | How Floorline uses it |
|---|---|
| Track 01 | A new primitive for Monad: fully backed downside protection, priced, hedged and settled on chain. |
| Agora | Mobile trading app. Passkey sign in, AUSD balance, floors paid and backed in AUSD, Perpl trades in the app. |
| Perpl | Price, settlement oracle and hedge venue. An automated delta hedging bot on Perpl's trading API. |
| Chainlink CRE | A workflow that computes MON's realised volatility from Perpl candles and writes it on chain as an independent check, and settles expired series. |
| Kuru | Floors as a new asset class on Kuru's order book. |
| Aurora Intents | Add money from Base, Arbitrum, Ethereum and more straight into the Monad account. |
| Mera | The whole account layer. A passkey on the phone, no seed phrase, no extension. |
| Envio | HyperIndex indexes every vault and volatility event for the proof page and history. |

## Architecture

```
app/        Expo (React Native) app. Mera passkey account, viem.
web/        Static site: landing, /demo, /proof. Reads the chain directly.
contracts/  Foundry. FloorVault, HedgedFloorVault, VolFeed, PerplPriceSource, CreReceiver.
keeper/     TypeScript bot: hedges on Perpl, posts volatility, opens and settles series.
cre/        Chainlink CRE workflow: observed volatility and settlement.
indexer/    Envio HyperIndex config and handlers.
docs/       PRD, plan, build log, deployments, submission checklist.
```

Safety checks in the vault: price freshness, mark against oracle deviation, a settlement window after which only the owner can settle, an emergency settle after one day, a step limit on volatility updates, a slippage bound on hedge orders, and a block on deposits while the valuation is stale.

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
cd contracts
forge test
```

Keeper:

```sh
cd keeper
npm install
npm test
npm start     # needs a .env with the keeper key and vault address
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
