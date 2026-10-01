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
    apiPrivateKeyHex: process.env.PERPL_API_ED25519_KEY,
    tradingEnabled: process.env.TRADING_ENABLED === "1",
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
