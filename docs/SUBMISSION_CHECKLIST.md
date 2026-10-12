# Submission checklist

Ticked only from the live app, never from intent.

Last checked: 10 Oct 2026.

Main submission (all tracks):
- [x] Public GitHub repo, MIT license, README with setup, attribution of external code, AI-use disclosure. https://github.com/jenzylove/floorline
- [x] Commit history covering the build window. 30 Sep to 10 Oct, on `main`
- [x] Demo video ≤ 3 min, public, product running, Monad interactions visible: https://youtu.be/rr5IbMoxjOg
- [x] Contract addresses / tx hashes; deployed to Monad mainnet. README and DEPLOYMENTS.md
- [x] Docs: description, architecture, stack, setup, why Monad. README

Agora, Best Mobile Trading App (Track 01):
- [x] Mobile app. Android APK on the GitHub release
- [x] Authenticates via Mera passkey. Account created on a real phone, 9 Oct
- [x] Holds and displays an AUSD balance. 2.000341 AUSD after the 10 Oct deposit
- [x] Executes trades through Perpl in the app. Done on a real phone, 11 Oct, from the passkey account: Perpl account #5455 opened `0x1391a70f…0a62`, trade opened `0xa06ca86f…192f`, closed `0x91e17cc5…85d7`
- [x] Demo video ≤ 2 min: passkey login, AUSD balance, at least one Perpl trade: https://youtu.be/7az2z-jolro
- [x] Write-up of core features. README, "The app"

Kuru, Bring New Assets and Markets (Track 01):
- [x] A new class of tradable markets on Kuru Spot V2. FLOOR/USDC `0xFD5d4Ad286C43dBFd2B2A1Ce0db82E6EA6f5aa38`, registered by Kuru's team 11 Oct `0xae140900…91f1`; keeper quotes `0x7cba244b…c4ba`, taker fill `0x4c811176…9274`, refill `0x192c5148…a542`. Monad testnet, Kuru's test USDC.
- [x] Before the V2 listing: the same market on Kuru's older Router, testnet, with a test dollar (10 Oct, quotes `0x4bbfd93d…acd5`, taker fill `0x09e31beb…9541`, refill `0xd7f51238…0865`). Retired once V2 was live.
- [x] The infrastructure that makes them viable (vault, pricing, settlement). Live on mainnet

- [x] A ladder of markets, opened daily: six floors at once (1 day at 3/6/10% under MON, 1 week at 5/10/15%), each with its own book on Kuru's Router, listed in `KuruLadder` `0x9ccFD82dA30022b06bB9325aE22dA02dde5Cb293` and quoted both sides; a wallet bought 363 floors `0x462154a5…f6` and sold 200 back `0x4b1563b4…2d` (12 Oct)

Kuru, Next Consumer Trading App (Track 01):
- [x] A spot trading product routing trades through Kuru's order book. "Floors on Kuru" in the app reads the Spot V2 book and sends orders to the market contract from the passkey account. Done on a real phone, 11 Oct: 7,700 floors bought for about 10.34 test USDC `0x402fb4f5…45c8`. Testnet

Perpl, Best use of Perpl's API (all tracks):
- [x] Production-ready automation on Perpl (hedging keeper). 75+ real fills through the trading API, listed on /proof; since 11 Oct the hedge runs from the vault's own Perpl account #5456 (`0x7cbf1bdc…9a50`)

Chainlink, Best workflow with CRE (all tracks):
- [x] CRE workflow built and simulated as an orchestration layer (observed vol, settlement). Simulated only, with a broadcast run on mainnet: `0x324fb420…4440`

Aurora Intents (all tracks):
- [x] Any-chain deposit into the app. 2.005 USDC on Base delivered as 2.0 USDC on Monad `0x18bb072f…13bc`, 10 Oct

Mera UX (all tracks):
- [x] Mera is the entire account layer: no seed phrase, no extension, no custody backend

Envio (all tracks):
- [x] HyperIndex powering a core feature (/proof and history)
