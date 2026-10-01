# Spike: Mera passkey account inside an Expo app (Android)

**Question.** Can a React Native (Expo SDK 57) app on a real Android phone create a passkey with PRF, derive an EVM
account from it with Mera, sign with it, and read its AUSD balance on Monad mainnet?

**What was built** (`app/`):
- `@category-labs/mera` 0.2.0 with its React Native WebAuthn client (`react-native-passkey` 3.6.1), `expo-crypto`
  polyfill for `crypto.getRandomValues` (Hermes lacks it).
- Derivation as in Mera's "create passkey accounts" recipe: PRF output → BIP-39 mnemonic → seed →
  `m/44'/60'/0'/0/0` → `createSecp256k1SigningSession` → `toViemAccount`. Only the credential id is stored
  (`expo-secure-store`); it holds no key material.
- Relying party ID `floorline-app.vercel.app`, which must serve `/.well-known/assetlinks.json` naming the app's
  package and signing certificate.
- Screen: create / sign in with passkey, address, live AUSD and MON balances, sign a test message and verify it.

**Checked so far:** type check passes; Android JS bundle builds (`expo export`, 3.7 MB). Cloud build (EAS, preview APK)
started.

**Verdict:** pending the on-device run.
