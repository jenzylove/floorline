import { explainRevert } from "./data";

/**
 * Turn any failure into one plain sentence a person can act on. Raw codes, hashes and stack traces never
 * reach the screen; the original goes to the console for debugging.
 */
const RULES: [RegExp, string][] = [
  [/NO_QUOTE|no quote|no route/i, "No route for that amount right now. Wait a moment and try again, or try a different amount."],
  [/Preview is read only/i, "This is a preview. Sign in on your phone to do this."],
  [/cancel|abort|NotAllowedError|user denied|rejected/i, "Cancelled. Nothing was sent."],
  [/insufficient funds|gas required exceeds|exceeds the balance/i, "Not enough MON to pay the network fee. Add a little MON in Wallet, then try again."],
  [/transfer amount exceeds|ERC20InsufficientBalance|exceeds balance/i, "You don't have enough AUSD for that."],
  [/HTTP request failed|fetch failed|Network request failed|UnknownHost|timed out|took too long|HTTP 5\d\d|HTTP 429/i, "Can't reach the network right now. Check your connection and try again."],
  [/nonce|replacement transaction|already known/i, "Your last action is still going through. Give it a few seconds, then try again."],
];

export function friendly(e: unknown): string {
  const raw = e instanceof Error ? `${e.message} ${(e as { shortMessage?: string }).shortMessage ?? ""}` : String(e);
  console.warn("[floorline]", raw);
  // the vault's own refusals already have written reasons (price moved, paused, and so on)
  const known = explainRevert(e);
  if (known !== raw.split("\n")[0].slice(0, 160)) return known;
  for (const [re, text] of RULES) if (re.test(raw)) return text;
  return "That didn't go through and nothing was taken. Try again in a moment.";
}
