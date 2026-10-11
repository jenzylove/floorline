// Kuru V2 probe: deposit the maker's inventory into its Kuru account and print what the SDK offers.
import type { Hex } from "viem";
import { V2, accountIdOf, balances, clients, depositAll, readMarket } from "../src/kuru/v2.js";

const c = clients(process.env.KEEPER_PRIVATE_KEY as Hex);
const m = await readMarket();
console.log("market", m);
console.log("spot:", Object.keys(c.kuru.spot).filter((k) => !k.startsWith("build")).join(" "));
console.log("account:", Object.keys(c.kuru.account).filter((k) => !k.startsWith("build")).join(" "));
for (const t of [m.base, m.quote]) console.log("deposit", t, await depositAll(c, t));
const id = await accountIdOf(c.account.address);
console.log("accountId", id, "base", await balances(BigInt(id), m.base, m.baseDecimals), "quote", await balances(BigInt(id), m.quote, m.quoteDecimals), V2.market);
