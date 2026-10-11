import { createWalletClient, maxUint256, parseUnits, type Address, type Hash, type LocalAccount } from "viem";
import { client, monad, transport } from "./chain";
import { ADDR, MON_MARKET, ORDER, erc20Abi, perplAbi, vaultAbi } from "./contracts";
import { unitsToWei } from "./data";

/**
 * Every write is signed on the phone by the passkey account (Mera) and sent to Monad mainnet.
 * Monad's gas estimates can be too low for these calls, so each write carries an explicit limit.
 */
const GAS = { approve: 100_000n, buy: 900_000n, redeem: 400_000n, deposit: 500_000n, withdraw: 500_000n, perplOpen: 600_000n, perplOrder: 1_500_000n, perplMove: 400_000n, send: 120_000n };

export type Step = (label: string, hash?: Hash) => void;

function walletFor(account: LocalAccount) {
  return createWalletClient({ account, chain: monad, transport });
}

async function wait(hash: Hash) {
  const r = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return r;
}

async function ensureAllowance(account: LocalAccount, spender: `0x${string}`, needed: bigint, step: Step) {
  const current = await client.readContract({ address: ADDR.ausd, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
  if (current >= needed) return;
  step("Allow AUSD");
  const hash = await walletFor(account).writeContract({ address: ADDR.ausd, abi: erc20Abi, functionName: "approve", args: [spender, maxUint256], gas: GAS.approve });
  step("Allow AUSD", hash);
  await wait(hash);
}

/** Buy protection on `units` MON. Accepts up to 2% above the quote the user saw. */
export async function buyProtection(account: LocalAccount, seriesId: number, units: number, quotedPremium: number, step: Step): Promise<Hash> {
  const maxPremium = BigInt(Math.ceil(quotedPremium * 1.02 * 1e6));
  await ensureAllowance(account, ADDR.vault, maxPremium, step);
  step("Buy protection");
  const hash = await walletFor(account).writeContract({
    address: ADDR.vault,
    abi: vaultAbi,
    functionName: "buy",
    args: [BigInt(seriesId), unitsToWei(units), maxPremium, account.address],
    gas: GAS.buy,
  });
  step("Buy protection", hash);
  await wait(hash);
  return hash;
}

export async function redeemProtection(account: LocalAccount, seriesId: number, units: number, step: Step): Promise<Hash> {
  step("Collect payout");
  const hash = await walletFor(account).writeContract({
    address: ADDR.vault,
    abi: vaultAbi,
    functionName: "redeem",
    args: [BigInt(seriesId), unitsToWei(units), account.address],
    gas: GAS.redeem,
  });
  step("Collect payout", hash);
  await wait(hash);
  return hash;
}

export async function depositEarn(account: LocalAccount, ausd: number, step: Step): Promise<Hash> {
  const assets = BigInt(Math.floor(ausd * 1e6));
  await ensureAllowance(account, ADDR.vault, assets, step);
  step("Deposit");
  const hash = await walletFor(account).writeContract({ address: ADDR.vault, abi: vaultAbi, functionName: "deposit", args: [assets, account.address], gas: GAS.deposit });
  step("Deposit", hash);
  await wait(hash);
  return hash;
}

export async function withdrawEarn(account: LocalAccount, ausd: number, step: Step): Promise<Hash> {
  const assets = BigInt(Math.floor(ausd * 1e6));
  step("Withdraw");
  const hash = await walletFor(account).writeContract({
    address: ADDR.vault,
    abi: vaultAbi,
    functionName: "withdraw",
    args: [assets, account.address, account.address],
    gas: GAS.withdraw,
  });
  step("Withdraw", hash);
  await wait(hash);
  return hash;
}

// ---------------------------------------------------------------- Perpl, from the user's own account

export async function perplOpenAccount(account: LocalAccount, ausd: number, step: Step): Promise<Hash> {
  const amount = BigInt(Math.floor(ausd * 1e6));
  await ensureAllowance(account, ADDR.perpl, amount, step);
  step("Open Perpl account");
  const hash = await walletFor(account).writeContract({ address: ADDR.perpl, abi: perplAbi, functionName: "createAccount", args: [amount], gas: GAS.perplOpen });
  step("Open Perpl account", hash);
  await wait(hash);
  return hash;
}

/**
 * A market order on Perpl's MON perpetual, immediate-or-cancel, with the worst price 1% from the mark.
 * Opens or closes `lots` MON (Perpl's MON market trades whole MON).
 */
export async function perplOrder(
  account: LocalAccount,
  kind: keyof typeof ORDER,
  lots: number,
  mark: number,
  leverage: number,
  step: Step,
): Promise<Hash> {
  const buying = kind === "openLong" || kind === "closeShort";
  const limit = BigInt(Math.round(mark * (buying ? 1.01 : 0.99) * 1e6));
  const block = await client.getBlockNumber();
  step("Send order to Perpl");
  const hash = await walletFor(account).writeContract({
    address: ADDR.perpl,
    abi: perplAbi,
    functionName: "execOrder",
    args: [
      {
        orderDescId: block,
        perpId: BigInt(MON_MARKET),
        orderType: ORDER[kind],
        orderId: 0n,
        pricePNS: limit,
        lotLNS: BigInt(lots),
        expiryBlock: 0n,
        postOnly: false,
        fillOrKill: false,
        immediateOrCancel: true,
        maxMatches: 0n,
        leverageHdths: BigInt(Math.round(leverage * 100)),
        lastExecutionBlock: block + 20n,
        amountCNS: 0n,
        maxNegPnlCollatBPS: 300n, // Perpl's market default; 0 makes taker orders fail
      },
    ],
    gas: GAS.perplOrder,
  });
  step("Send order to Perpl", hash);
  await wait(hash);
  return hash;
}

/** Add AUSD to, or take free AUSD out of, the user's own Perpl account. Withdrawals land back in the passkey account. */
export async function perplMove(account: LocalAccount, dir: "in" | "out", ausd: number, step: Step): Promise<Hash> {
  const amount = BigInt(Math.floor(ausd * 1e6));
  if (dir === "in") await ensureAllowance(account, ADDR.perpl, amount, step);
  const label = dir === "in" ? "Add to Perpl" : "Withdraw from Perpl";
  step(label);
  const hash = await walletFor(account).writeContract({
    address: ADDR.perpl,
    abi: perplAbi,
    functionName: dir === "in" ? "depositCollateral" : "withdrawCollateral",
    args: [amount],
    gas: GAS.perplMove,
  });
  step(label, hash);
  await wait(hash);
  return hash;
}

// ---------------------------------------------------------------- out of the app

/** Send AUSD or MON from the passkey account to any Monad address. */
export async function sendOut(account: LocalAccount, token: "AUSD" | "MON", to: Address, amount: number, step: Step): Promise<Hash> {
  const label = `Send ${token}`;
  step(label);
  const w = walletFor(account);
  const hash =
    token === "MON"
      ? await w.sendTransaction({ to, value: parseUnits(amount.toFixed(18), 18), gas: 30_000n })
      : await w.writeContract({ address: ADDR.ausd, abi: erc20Abi, functionName: "transfer", args: [to, BigInt(Math.floor(amount * 1e6))], gas: GAS.send });
  step(label, hash);
  await wait(hash);
  return hash;
}
