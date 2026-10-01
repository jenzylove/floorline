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

**Checked so far:**
- Type check passes; Android JS bundle builds (`expo export`, 3.7 MB).
- EAS cloud build (preview APK) finished after about 2 hours in the free queue: build `87126fc8-0ca8-4dd7-9ee8-67ee1a576bd9`.
- APK signing certificate SHA-256 (read from the APK v2 signing block):
  `A2:6D:9D:1C:63:16:7A:1B:5B:FA:DE:1D:45:73:76:F9:DC:92:C8:1B:73:B6:22:BC:D7:03:EF:99:9D:A4:3E:FE`.
- `https://floorline-app.vercel.app/.well-known/assetlinks.json` is live, and Google's Digital Asset Links API returns
  the `get_login_creds` statement for `com.jenzylove.floorline` with that fingerprint.

**Verdict:** pending the on-device run.
