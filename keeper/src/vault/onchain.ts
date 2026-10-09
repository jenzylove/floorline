import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { log } from "../log.js";

const vaultAbi = parseAbi([
  "function hedge(uint256 marketId, bool open, uint256 lots, uint256 limitPrice)",
  "function shortLots(uint256 marketId) view returns (uint256)",
  "function hedgeEquity() view returns (uint256)",
  "function perplAccountId() view returns (uint256)",
  "function maxHedgeSlippageBps() view returns (uint256)",
  "function maxHedgeLots(uint256) view returns (uint256)",
  "function settle(uint256 seriesId)",
  "function settleWindow() view returns (uint256)",
  "function activeSeriesIds() view returns (uint256[])",
  "function getSeries(uint256) view returns ((uint256 marketId, uint256 strike, uint64 expiry, bool settled, address token, uint256 locked, uint256 payoutPerToken, uint256 settlePrice, uint256 owed))",
  "function volFeed() view returns (address)",
  "function createSeries(uint256 marketId, uint256 strike, uint64 expiry) returns (uint256)",
  "function seriesCreatedAt(uint256) view returns (uint64)",
  "function priceSource() view returns (address)",
]);
const pxAbi = parseAbi(["function price(uint256) view returns (uint256 price6, uint256 updatedAt)"]);
const volAbi = parseAbi([
  "function update(uint256 marketId, uint256 vol, bytes32 source)",
  "function get(uint256) view returns (uint256 vol, uint256 updatedAt)",
  "function maxStepBps() view returns (uint256)",
]);

// Monad's gas estimates can come back too low (a redeem ran out of gas in cycle 1), so every write
// carries an explicit limit.
const GAS = { hedge: 1_500_000n, settle: 600_000n, vol: 150_000n, create: 2_500_000n };

/**
 * Executes the hedge from the vault's own Perpl account by calling `HedgedFloorVault.hedge`, so
 * the short, its fills and its profit or loss belong to the vault and count in its share price.
 * The contract bounds what the keeper can do: enabled markets, a lot cap, and a limit price within
 * `maxHedgeSlippageBps` of Perpl's oracle.
 */
export class VaultExecutor {
  readonly address: Address;
  private wallet: WalletClient;

  constructor(
    private client: PublicClient,
    rpcUrl: string,
    chainId: number,
    privateKey: Hex,
    readonly vault: Address,
  ) {
    const account = privateKeyToAccount(privateKey);
    this.address = account.address;
    const chain = defineChain({
      id: chainId,
      name: chainId === 143 ? "Monad" : "Monad Testnet",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    this.wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  }

  async read<T>(functionName: string, args: unknown[] = []): Promise<T> {
    return (await this.client.readContract({ address: this.vault, abi: vaultAbi, functionName: functionName as never, args: args as never })) as T;
  }

  async shortLots(marketId: number): Promise<number> {
    return Number(await this.read<bigint>("shortLots", [BigInt(marketId)]));
  }

  /** Hedge account equity in AUSD. */
  async equity(): Promise<number> {
    return Number(await this.read<bigint>("hedgeEquity")) / 1e6;
  }

  async bandBps(): Promise<number> {
    return Number(await this.read<bigint>("maxHedgeSlippageBps"));
  }

  private async send(label: string, req: Parameters<WalletClient["writeContract"]>[0]): Promise<{ hash: Hex; ok: boolean }> {
    const hash = await this.wallet.writeContract(req);
    const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    const ok = receipt.status === "success";
    log(label, { hash, ok, block: Number(receipt.blockNumber), gasUsed: Number(receipt.gasUsed) });
    return { hash, ok };
  }

  hedge(marketId: number, open: boolean, lots: number, limitPrice: number) {
    return this.send("vault_hedge_tx", {
      address: this.vault,
      abi: vaultAbi,
      functionName: "hedge",
      args: [BigInt(marketId), open, BigInt(lots), BigInt(limitPrice)],
      gas: GAS.hedge,
      account: this.wallet.account!,
      chain: this.wallet.chain,
    });
  }

  /**
   * Settle every expired, unsettled series inside its settle window. The keeper does this in the
   * first loop after expiry; holders and the CRE workflow can too, so nobody waits on one party.
   */
  async settleExpired(nowSec = Math.floor(Date.now() / 1000)): Promise<number> {
    const ids = await this.read<bigint[]>("activeSeriesIds");
    const window = Number(await this.read<bigint>("settleWindow"));
    let n = 0;
    for (const id of ids) {
      const s = await this.read<{ expiry: bigint; settled: boolean; locked: bigint }>("getSeries", [id]);
      const expiry = Number(s.expiry);
      if (s.settled || nowSec < expiry) continue;
      if (nowSec > expiry + window) {
        log("settle_missed_window", { seriesId: Number(id), expiry, window, note: "owner must settle late" });
        continue;
      }
      const r = await this.send("settle_tx", {
        address: this.vault,
        abi: vaultAbi,
        functionName: "settle",
        args: [id],
        gas: GAS.settle,
        account: this.wallet.account!,
        chain: this.wallet.chain,
      }).catch((e) => {
        // most often the oracle has not printed a price after expiry yet; next loop retries
        log("settle_wait", { seriesId: Number(id), reason: String(e).slice(0, 200) });
        return undefined;
      });
      if (r?.ok) n++;
    }
    return n;
  }

  /** Open series on a market with their creation time, for the rolling-series check. */
  async openSeries(marketId: number): Promise<{ strike: number; expiry: number; createdAt: number }[]> {
    const ids = await this.read<bigint[]>("activeSeriesIds");
    const out = [];
    for (const id of ids) {
      const s = await this.read<{ marketId: bigint; strike: bigint; expiry: bigint; settled: boolean }>("getSeries", [id]);
      if (Number(s.marketId) !== marketId || s.settled) continue;
      const createdAt = Number(await this.read<bigint>("seriesCreatedAt", [id]));
      out.push({ strike: Number(s.strike), expiry: Number(s.expiry), createdAt });
    }
    return out;
  }

  /** The vault's own oracle price for a market, AUSD 6 dp, so strikes are set from the price the vault uses. */
  async spot6(marketId: number): Promise<number> {
    const px = await this.read<Address>("priceSource");
    const [p] = (await this.client.readContract({ address: px, abi: pxAbi, functionName: "price", args: [BigInt(marketId)] })) as [bigint, bigint];
    return Number(p);
  }

  createSeries(marketId: number, strike: number, expiry: number) {
    return this.send("series_tx", {
      address: this.vault,
      abi: vaultAbi,
      functionName: "createSeries",
      args: [BigInt(marketId), BigInt(strike), BigInt(expiry)],
      gas: GAS.create,
      account: this.wallet.account!,
      chain: this.wallet.chain,
    });
  }

  async volFeed(): Promise<Address> {
    return this.read<Address>("volFeed");
  }

  async currentVol(feed: Address, marketId: number): Promise<{ vol: number; updatedAt: number; maxStepBps: number }> {
    const [vol, at] = (await this.client.readContract({ address: feed, abi: volAbi, functionName: "get", args: [BigInt(marketId)] })) as [bigint, bigint];
    const step = (await this.client.readContract({ address: feed, abi: volAbi, functionName: "maxStepBps" })) as bigint;
    return { vol: Number(vol) / 1e18, updatedAt: Number(at), maxStepBps: Number(step) };
  }

  postVol(feed: Address, marketId: number, volWad: bigint, source: Hex) {
    return this.send("vol_tx", {
      address: feed,
      abi: volAbi,
      functionName: "update",
      args: [BigInt(marketId), volWad, source],
      gas: GAS.vol,
      account: this.wallet.account!,
      chain: this.wallet.chain,
    });
  }
}

/**
 * The vault rejects a hedge whose limit is further than its band from Perpl's oracle. Check it
 * before sending, so a dislocated book means "hold", not a reverted transaction.
 */
export function withinOracleBand(open: boolean, limitPrice: number, oracle: number, bandBps: number): boolean {
  const band = Math.floor((oracle * bandBps) / 10_000);
  return open ? limitPrice >= oracle - band : limitPrice <= oracle + band;
}
