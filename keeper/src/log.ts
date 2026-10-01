import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let dir = "logs";

export function initLog(d: string) {
  dir = d;
  mkdirSync(dir, { recursive: true });
}

/** One JSON line per event, to stdout and logs/<day>.jsonl. These files feed the /proof page. */
export function log(event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...data });
  console.log(line);
  try {
    appendFileSync(join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`), line + "\n");
  } catch {
    /* logging must never stop the bot */
  }
}
