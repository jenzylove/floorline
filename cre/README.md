# Floorline on Chainlink CRE

One workflow, `floorline-workflow`, on a 5 minute cron:

1. **Vol input.** Each node reads Perpl's public candles for MON (24h of 5 minute candles), computes realised
   volatility, and the nodes' answers are reduced to their median. Too few candles means the node throws and nothing
   is written. The result is clamped to the vault's 10% to 500% bounds.
2. **Vol write.** A signed CRE report goes to `CreReceiver`, which writes it to `VolFeed` (source tag `chainlink-cre`).
3. **Settlement.** The workflow reads the vault's active series, and for any that have expired it sends a settle report.

Status: **simulated, not deployed.** Chainlink gates deploy access behind a sales call. The receiver trusts the CRE
*simulation* forwarder for Monad mainnet, so a simulation run with `--broadcast` writes through it. Production would
swap in the production forwarder with `setForwarder`.

## Simulate (Windows PowerShell)

```powershell
winget install Oven-sh.Bun
cd floorline\cre
Copy-Item .env.example .env
notepad .env                      # CRE_ETH_PRIVATE_KEY=<throwaway key, 64 hex, no 0x>
cd floorline-workflow
bun install
cd ..
cre workflow simulate floorline-workflow --target staging-settings
```

Add `--broadcast` to send the reports on-chain (needs a little MON for gas on that key).

## Tests

`npm test` in `floorline-workflow` checks the vol maths against a hand calculation. `forge test --match-contract CreReceiverTest` in `contracts` checks the receiver.
