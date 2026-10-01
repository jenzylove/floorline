import {
  CronCapability,
  EVMClient,
  HTTPClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  Runner,
  bytesToHex,
  consensusMedianAggregation,
  encodeCallMsg,
  getNetwork,
  handler,
  hexToBase64,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, zeroAddress } from "viem";
import { clampVol, realizedVol, volToWad } from "./vol";

type Config = {
  schedule: string;
  perplApi: string;
  perplMarketId: number;
  candleSeconds: number;
  windowHours: number;
  chainName: string;
  vault: string;
  receiver: string;
  gasLimit: string;
};

const ACTION_SET_VOL = 1n;
const ACTION_SETTLE = 2n;

const vaultAbi = parseAbi([
  "function activeSeriesIds() view returns (uint256[])",
  "function getSeries(uint256) view returns ((uint256 marketId, uint256 strike, uint64 expiry, bool settled, address token, uint256 locked, uint256 payoutPerToken, uint256 settlePrice, uint256 owed))",
]);

/**
 * Each node reads Perpl's public candles and computes the realised vol itself. The nodes' answers are
 * reduced to their median, so one bad node or one bad response cannot move the number on its own.
 * If there are too few candles the node throws, and the workflow writes nothing (fail closed).
 */
const fetchVol = (node: NodeRuntime<Config>): bigint => {
  const c = node.config;
  const to = node.now().getTime();
  const from = to - c.windowHours * 3600 * 1000;
  const url = `${c.perplApi}/v1/market-data/${c.perplMarketId}/candles/${c.candleSeconds}/${from}-${to}`;
  const resp = new HTTPClient().sendRequest(node, { url, method: "GET" as const }).result();
  if (resp.statusCode !== 200) throw new Error(`Perpl candles returned HTTP ${resp.statusCode}`);
  const body = JSON.parse(new TextDecoder().decode(resp.body)) as { d: { t: number; c: number }[] };
  const rv = realizedVol(body.d, c.candleSeconds);
  if (rv === undefined) throw new Error(`too few candles (${body.d.length}) to compute volatility`);
  return volToWad(clampVol(rv));
};

function sendReport(runtime: Runtime<Config>, chainSelector: bigint, action: bigint, a: bigint, b: bigint): string {
  const cfg = runtime.config;
  const payload = encodeAbiParameters(parseAbiParameters("uint8 action, uint256 a, uint256 b"), [Number(action), a, b]);
  const report = runtime
    .report({ encodedPayload: hexToBase64(payload), encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" })
    .result();
  const res = new EVMClient(chainSelector)
    .writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: cfg.gasLimit } })
    .result();
  return bytesToHex(res.txHash || new Uint8Array(32));
}

const onCron = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainName });
  if (!network) throw new Error(`unknown chain ${cfg.chainName}`);
  const selector = network.chainSelector.selector;

  // 1. Volatility input
  const volWad = runtime.runInNodeMode(fetchVol, consensusMedianAggregation())().result();
  runtime.log(`MON realised vol (${cfg.windowHours}h of ${cfg.candleSeconds}s candles, median of nodes): ${Number(volWad) / 1e18}`);
  runtime.log(`vol report tx: ${sendReport(runtime, selector, ACTION_SET_VOL, BigInt(cfg.perplMarketId), volWad)}`);

  // 2. Settlement: find expired, unsettled series and settle them
  const evm = new EVMClient(selector);
  const read = (data: `0x${string}`) =>
    evm
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: cfg.vault as `0x${string}`, data }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();

  const ids = decodeFunctionResult({
    abi: vaultAbi,
    functionName: "activeSeriesIds",
    data: bytesToHex(read(encodeFunctionData({ abi: vaultAbi, functionName: "activeSeriesIds" })).data),
  }) as bigint[];
  const nowSec = Math.floor(runtime.now().getTime() / 1000);
  let settled = 0;
  for (const id of ids) {
    const s = decodeFunctionResult({
      abi: vaultAbi,
      functionName: "getSeries",
      data: bytesToHex(read(encodeFunctionData({ abi: vaultAbi, functionName: "getSeries", args: [id] })).data),
    }) as { expiry: bigint; settled: boolean };
    if (s.settled || Number(s.expiry) > nowSec) continue;
    runtime.log(`series ${id} expired at ${s.expiry}, settling`);
    runtime.log(`settle report tx: ${sendReport(runtime, selector, ACTION_SETTLE, id, 0n)}`);
    settled++;
  }
  return `vol updated, ${ids.length} active series, ${settled} settled`;
};

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
