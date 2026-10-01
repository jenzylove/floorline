// Hermes has no crypto.getRandomValues; mera and viem need it. Load before anything that imports them.
import { getRandomValues } from "expo-crypto";

if (typeof globalThis.crypto?.getRandomValues !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { ...globalThis.crypto, getRandomValues },
  });
}
