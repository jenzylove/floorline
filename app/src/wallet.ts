import { createPasskeyWithPrfOutput, createSecp256k1SigningSession, getPasskeyPrfOutput, isMeraError } from "@category-labs/mera";
import { reactNativeWebAuthnClient } from "@category-labs/mera/react-native-webauthn-client";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as SecureStore from "expo-secure-store";
import type { PasskeyCredentialMetadata } from "@category-labs/mera";
import type { LocalAccount } from "viem";

/** The passkey belongs to this host. It serves /.well-known/assetlinks.json naming this app. */
export const RP_ID = "floorline-app.vercel.app";
const CRED_KEY = "floorline.passkey.credential";

export type Session = { account: LocalAccount; end: () => void };

/**
 * Passkey PRF output -> BIP-39 mnemonic -> seed -> m/44'/60'/0'/0/0, as in mera's "create passkey accounts" recipe,
 * so the same passkey gives the same address on the web and in the app. Nothing secret is stored: only the
 * credential id, which holds no key material.
 */
function sessionFromPrf(prf: Uint8Array): Session {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prf, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  const privateKey = node.privateKey!;
  const session = createSecp256k1SigningSession({ privateKey });
  privateKey.fill(0);
  seed.fill(0);
  return { account: toViemAccount(session), end: () => session.end() };
}

export async function createAccount(): Promise<Session> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: RP_ID, name: "Floorline" },
    user: { name: "floorline", displayName: "Floorline account" },
    webAuthnClient: reactNativeWebAuthnClient,
  });
  const stored: PasskeyCredentialMetadata = { credentialId: created.credentialId, transports: created.transports };
  await SecureStore.setItemAsync(CRED_KEY, JSON.stringify(stored));
  return sessionFromPrf(created.prfOutput);
}

export async function signIn(): Promise<Session> {
  const raw = await SecureStore.getItemAsync(CRED_KEY);
  // With no stored credential (new install), the phone offers any Floorline passkey it holds.
  const credential = raw ? (JSON.parse(raw) as PasskeyCredentialMetadata) : undefined;
  const res = await getPasskeyPrfOutput({ rpId: RP_ID, credential, webAuthnClient: reactNativeWebAuthnClient });
  if (!credential) await SecureStore.setItemAsync(CRED_KEY, JSON.stringify({ credentialId: res.credentialId }));
  return sessionFromPrf(res.prfOutput);
}

export function describeError(e: unknown): string {
  if (isMeraError(e)) return `${e.code}: ${e.message}`;
  const msg = e instanceof Error ? e.message : String(e);
  // a network failure is the phone's connection, not something the person can read a stack trace for
  if (/HTTP request failed|fetch failed|Network request failed|UnknownHost|timed out|took too long/i.test(msg)) return "Can't reach Monad right now. Check your connection. The app keeps trying.";
  return msg.split("\n")[0].slice(0, 180);
}
