# Floorline indexer (Envio HyperIndex)

Indexes, on Monad mainnet: vault activity (deposits, series, purchases, settlements, redemptions), volatility updates
(manual and `chainlink-cre`), and the hedge account's short-side fills read from Perpl's own position events
(account ids in `ENVIO_HEDGE_ACCOUNT_IDS`, default `5374`).

- `config.yaml` uses HyperSync (for Envio Cloud).
- `config.rpc.yaml` is the same over the public Monad RPC, for local runs where HyperSync is unreachable:
  `npx envio dev --config config.rpc.yaml` (needs Docker). GraphQL at http://localhost:8080 (admin secret `testing`).

Checked locally on 2026-10-01 against the first mainnet cycle: 5 vault events, 1 series, 2 vol updates and 40 hedge
fills, matching the chain.
