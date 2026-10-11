/**
 * Every transaction an account has sent, found from the chain alone: for each nonce, binary search the
 * block where the account's transaction count passed it, then read that block for the transaction.
 * Used to put the phone account's real actions on /proof.   npx tsx scripts/account-history.ts 0x…
 */
import { type Address, createPublicClient, decodeFunctionData, http, parseAbi } from "viem";

const who = process.argv[2] as Address;
const pub = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://rpc.monad.xyz") });
const abi = parseAbi([
  "function approve(address,uint256)",
  "function transfer(address,uint256)",
  "function buy(uint256,uint256,uint256,address)",
  "function deposit(uint256,address)",
  "function withdraw(uint256,address,address)",
  "function redeem(uint256,uint256,address)",
  "function createAccount(uint256)",
  "function depositCollateral(uint256)",
  "function withdrawCollateral(uint256)",
]);

const head = await pub.getBlockNumber();
const total = await pub.getTransactionCount({ address: who });
const lookback = BigInt(process.env.LOOKBACK ?? 900_000);
let floor = head - lookback;
const out: unknown[] = [];
for (let n = 0; n < total; n++) {
  let lo = floor, hi = head;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const c = await pub.getTransactionCount({ address: who, blockNumber: mid });
    if (c > n) hi = mid;
    else lo = mid + 1n;
  }
  floor = lo;
  const block = await pub.getBlock({ blockNumber: lo, includeTransactions: true });
  const tx = block.transactions.find((t) => t.from.toLowerCase() === who.toLowerCase() && t.nonce === n);
  if (!tx) {
    out.push({ nonce: n, block: Number(lo), note: "not found in block" });
    continue;
  }
  let fn = tx.input.slice(0, 10);
  let args: string[] = [];
  try {
    const d = decodeFunctionData({ abi, data: tx.input });
    fn = d.functionName;
    args = (d.args ?? []).map(String);
  } catch {
    /* a call this script has no name for */
  }
  const r = await pub.getTransactionReceipt({ hash: tx.hash });
  out.push({ nonce: n, time: new Date(Number(block.timestamp) * 1000).toISOString(), to: tx.to, fn, args, ok: r.status === "success", hash: tx.hash });
}
console.log(JSON.stringify(out, null, 1));
