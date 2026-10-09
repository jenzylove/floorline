import { type Address } from "viem";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  return v === undefined ? fallback : Number(v);
}

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const chainId = num("PERPL_CHAIN_ID", 143);
  return {
    chainId,
    rpcUrl: env("RPC_URL", chainId === 143 ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz"),
    perplApi: env("PERPL_API_URL", chainId === 143 ? "https://app.perpl.xyz/api" : "https://testnet.perpl.xyz/api"),
    perplWs: env("PERPL_WS_URL", chainId === 143 ? "wss://app.perpl.xyz" : "wss://testnet.perpl.xyz"),
    vault: process.env.VAULT_ADDRESS as Address | undefined,
    volFeed: process.env.VOL_FEED_ADDRESS as Address | undefined,
    /** Perpl markets to hedge, e.g. "10" (MON) or "10,1". */
    markets: env("HEDGE_MARKETS", "10").split(",").map(Number),
    /** Trading needs a Perpl API key (trade scope) and its Ed25519 private key. Without them the bot runs read-only. */
    apiKey: process.env.PERPL_API_KEY,
    apiPrivateKeyHex: process.env.PERPL_API_KEY_SECRET,
    tradingEnabled: process.env.TRADING_ENABLED === "1",
    /**
     * Where hedge orders go.
     * "vault" (default): the keeper key calls HedgedFloorVault.hedge, so the short sits in the vault's own
     *   Perpl account and its profit or loss counts for depositors. Perpl's API supplies the market
     *   configuration, live order book, oracle and candles.
     * "api": orders go through Perpl's authenticated trading API from the API key's own account.
     */
    execution: (process.env.EXECUTION ?? "vault") as "vault" | "api",
    keeperKey: process.env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined,
    /** Standing menu of series the keeper keeps open, e.g. "1d:1.00,1d:0.90,7d:0.90". Empty turns it off. */
    seriesPlan: process.env.SERIES_PLAN ?? "1d:1.00,1d:0.90,7d:0.90",
    seriesEveryMs: num("SERIES_EVERY_MS", 5 * 60_000),
    vol: {
      /** Post the pricing vol this often. 0 turns it off (another updater posts it). */
      everyMs: num("VOL_EVERY_MS", 10 * 60_000),
      candleSeconds: num("VOL_CANDLE_SECONDS", 300),
      windowHours: num("VOL_WINDOW_HOURS", 24),
    },
    risk: {
      /** Do nothing while |target - current| is below this share of the target. */
      deadbandPct: num("DEADBAND_PCT", 0.1),
      /** Never send an order smaller than this many lots. */
      minOrderLots: num("MIN_ORDER_LOTS", 1),
      /** Largest single order, in AUSD notional. */
      maxOrderNotional: num("MAX_ORDER_NOTIONAL", 10),
      /** Largest total short, in AUSD notional. The hedge account is capped. */
      maxPositionNotional: num("MAX_POSITION_NOTIONAL", 9),
      /** Worst acceptable fill versus the touch, in bps. */
      maxSlippageBps: num("MAX_SLIPPAGE_BPS", 50),
      /** Stop opening new shorts when account equity falls below this, in AUSD. */
      minEquity: num("MIN_EQUITY", 5),
    },
    loopMs: num("LOOP_MS", 15_000),
    logDir: env("LOG_DIR", "logs"),
  };
}
