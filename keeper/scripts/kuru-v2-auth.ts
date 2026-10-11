// Kuru V2: check, and if needed grant, the maker's own right to trade from its Kuru account.
import type { Hex } from "viem";
import { accountCoreAbi } from "@toxicflow-labs/ts-sdk/abi";
import { V2, clients, pub } from "../src/kuru/v2.js";
const c = clients(process.env.KEEPER_PRIVATE_KEY as Hex);
const me = c.account.address;
const id = await pub.readContract({ address: V2.accountCore, abi: accountCoreAbi, functionName: "rootAccountIdOf", args: [me] });
const can = (perm: number) => pub.readContract({ address: V2.accountCore, abi: accountCoreAbi, functionName: "isAuthorizedAccountSignerById", args: [id, me, perm] });
console.log("account", id, "trade right before:", await can(1));
if (!(await can(1)) && process.argv[2] === "grant") {
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 90 * 86400);
  const hash = await c.wallet.writeContract({ address: V2.accountCore, abi: accountCoreAbi, functionName: "authorizeAccountSigner", args: [me, me, 1, expiry], gas: 300_000n });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log("authorize", hash, r.status, "trade right after:", await can(1));
}
