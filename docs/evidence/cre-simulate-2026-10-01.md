# CRE simulation, 2026-10-01

Run by the owner on Windows with CRE CLI (`cre workflow simulate floorline-workflow --target staging-settings`),
dry run (no `--broadcast`), so the write returns a zero tx hash.

```
✓ Workflow compiled
✓ Simulation limits enabled
  Binary hash: 0878131ecd952917934d7bbaf545552a773c812704a4f5101cbbe4ede3fb76b0
  Config hash: 3388d3bcb0593c9f7ff7cc55df8d066b8617921d489dc2d157043ec796238189
2026-10-01T09:49:38Z [SIMULATION] Simulator Initialized
2026-10-01T09:49:38Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-10-01T09:50:02Z [USER LOG] MON realised vol (24h of 300s candles, median of nodes): 2.542954
2026-10-01T09:50:03Z [USER LOG] vol report tx: 0x0000000000000000000000000000000000000000000000000000000000000000

✓ Workflow Simulation Result:
"vol updated, 0 active series, 0 settled"
```

What it shows: the workflow compiles to WASM, reads Perpl's public MON candles, computes realised vol (254.3%
annualised, matching an independent calculation from the same candles earlier the same day: 253.95%), builds a
signed report for `CreReceiver` (`0xA211561BfF51b923CcDfEfdadbc9c376238D697c`), and reads the vault's active series
(none at the time, since series 0 was already settled).

## Broadcast run, same day

`cre workflow simulate floorline-workflow --target staging-settings --broadcast`

```
2026-10-01T15:54:31Z [USER LOG] MON realised vol (24h of 300s candles, median of nodes): 2.551533
2026-10-01T15:54:33Z [USER LOG] vol report tx: 0x7a48e2c854da6e2ba7658afb7e005a92fa41e0ead786ff5b18a1b2c3de0b1c13
✓ Workflow Simulation Result:
"vol updated, 0 active series, 0 settled"
```

Checked on-chain: tx status 1 at block 109637342, sent to the CRE simulation forwarder
(`0x9eF6468C5f37b976E57d52054c693269479A784d`), which called `CreReceiver`, which wrote `VolFeed`. Logs from
VolFeed, CreReceiver and the forwarder. `VolFeed.get(10)` now returns 2.551533e18 (255.2%), replacing the manual 90%.
