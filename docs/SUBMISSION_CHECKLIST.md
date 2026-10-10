# Submission checklist

Ticked only from the live app, never from intent.

Last checked: 10 Oct 2026.

Main submission (all tracks):
- [x] Public GitHub repo, MIT license, README with setup, attribution of external code, AI-use disclosure. https://github.com/jenzylove/floorline
- [x] Commit history covering the build window. 30 Sep to 10 Oct, on `main`
- [ ] Demo video ≤ 3 min, public, product running, Monad interactions visible
- [x] Contract addresses / tx hashes; deployed to Monad mainnet. README and DEPLOYMENTS.md
- [x] Docs: description, architecture, stack, setup, why Monad. README

Agora, Best Mobile Trading App (Track 01):
- [x] Mobile app. Android APK on the GitHub release
- [x] Authenticates via Mera passkey. Account created on a real phone, 9 Oct
- [x] Holds and displays an AUSD balance. 2.000341 AUSD after the 10 Oct deposit
- [ ] Executes trades through Perpl in the app. Built; needs 10 AUSD in the app account for Perpl's minimum, not yet done on the phone
- [ ] Demo video ≤ 2 min: passkey login, AUSD balance, at least one Perpl trade
- [x] Write-up of core features. README, "The app"

Kuru, Bring New Assets and Markets (Track 01):
- [ ] A new class of tradable markets on Kuru's spot order book. Testnet only so far: market and a real fill on Kuru's older Router, 9 Oct. Spot V2 listing waits on Kuru's team (asked 9 Oct, reply: checking Monday 12 Oct)
- [x] The infrastructure that makes them viable (vault, pricing, settlement). Live on mainnet

Perpl, Best use of Perpl's API (all tracks):
- [x] Production-ready automation on Perpl (hedging keeper). 75+ real fills through the trading API, listed on /proof

Chainlink, Best workflow with CRE (all tracks):
- [x] CRE workflow built and simulated as an orchestration layer (observed vol, settlement). Simulated only, with a broadcast run on mainnet: `0x324fb420…4440`

Aurora Intents (all tracks):
- [x] Any-chain deposit into the app. 2.005 USDC on Base delivered as 2.0 USDC on Monad `0x18bb072f…13bc`, 10 Oct

Mera UX (all tracks):
- [x] Mera is the entire account layer: no seed phrase, no extension, no custody backend

Envio (all tracks):
- [x] HyperIndex powering a core feature (/proof and history)
