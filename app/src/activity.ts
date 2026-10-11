import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * What this account did from this phone, newest first, so a finished action can be found again after
 * leaving the screen. Kept on the phone only. Each entry links to its transaction.
 */
export type Entry = { label: string; hash: string; at: number };

const KEEP = 12;
const key = (addr: string) => `fl-activity-${addr.toLowerCase()}`;
let memory: Record<string, Entry[]> = {};
const listeners = new Set<() => void>();

export async function loadActivity(addr: string): Promise<Entry[]> {
  if (memory[addr]) return memory[addr];
  try {
    const raw = Platform.OS === "web" ? null : await SecureStore.getItemAsync(key(addr));
    memory[addr] = raw ? (JSON.parse(raw) as Entry[]) : [];
  } catch {
    memory[addr] = [];
  }
  return memory[addr];
}

export async function remember(addr: string, label: string, hash: string) {
  const list = [{ label, hash, at: Date.now() }, ...(await loadActivity(addr)).filter((e) => e.hash !== hash)].slice(0, KEEP);
  memory[addr] = list;
  listeners.forEach((f) => f());
  try {
    if (Platform.OS !== "web") await SecureStore.setItemAsync(key(addr), JSON.stringify(list));
  } catch {
    /* history is a convenience; it must never fail an action */
  }
}

export function onActivity(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
