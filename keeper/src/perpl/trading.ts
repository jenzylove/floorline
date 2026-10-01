import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import { log } from "../log.js";

/** Perpl order types on the API (1-indexed). */
export const OrderType = { OpenLong: 1, OpenShort: 2, CloseLong: 3, CloseShort: 4, Cancel: 5 } as const;
export const Flags = { GTC: 0, PostOnly: 1, FOK: 2, IOC: 4 } as const;
const FAILED = 7;
const DEFINITIVE = new Set([2, 3, 4, 5, 8, 9, 10]);
const SR_REQUEST_ID_TOO_LOW = 32;

export interface Position {
  pid: number;
  mkt: number;
  sd: number; // 1 long, 2 short
  s: number; // size, scaled
  st: number; // 1 open
  ep: number; // entry price, scaled
  c: string; // collateral
}

export interface OrderOutcome {
  rq: number;
  st: number;
  sr: number;
  fr?: number;
  fs: number; // filled size
  fp: number; // weighted fill price
  oid: number;
  raw: unknown;
}

export interface OrderSpec {
  mkt: number;
  t: number;
  p: number;
  s: number;
  fl: number;
  lv: number;
  mnp?: number;
}

interface InFlight {
  spec: OrderSpec;
  rq: number;
  sn: number;
  lb: number;
  reconnectEpoch: number;
  retriedNewRq: boolean;
  resolve: (o: OrderOutcome) => void;
  reject: (e: Error) => void;
}

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];

/**
 * Perpl authenticated trading WebSocket.
 * Implements the documented contract: Ed25519 API-key sign-in as the first frame, snapshot +
 * heartbeat sequence tracking (reconnect on gap), strictly increasing request IDs seeded from
 * `lfr`, at-most-once retries with the same `rq` until the last-execution block, a single retry
 * with a new `rq` on OrderDescIdTooLow or on expiry without status, and client-side dedup of
 * order updates (first definitive status wins).
 */
export class TradingClient extends EventEmitter {
  accountId?: number;
  forwardingAllowed = false;
  balance = 0n;
  locked = 0n;
  head = 0;
  positions = new Map<number, Position>();
  private ws?: WebSocket;
  private lastSn?: number;
  private lfr = 0;
  private localRq = 0;
  private sn = 0;
  private retry = 0;
  private epoch = 0;
  private ping?: NodeJS.Timeout;
  private inflight = new Map<number, InFlight>(); // by rq
  private bySn = new Map<number, number>(); // sn -> rq
  private settled = new Set<number>(); // rq already resolved (dedup)
  private ready?: () => void;
  readyPromise: Promise<void>;
  private stopped = false;

  constructor(
    private wsUrl: string,
    private chainId: number,
    private apiKey: string,
    private privateKeyHex: string,
    private orderTtl: (mkt: number) => number,
  ) {
    super();
    this.readyPromise = new Promise((r) => (this.ready = r));
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.ping);
    this.ws?.close();
  }

  /** Current short size on a market, in lots. */
  shortLots(mkt: number): number {
    let s = 0;
    for (const p of this.positions.values()) if (p.mkt === mkt && p.st === 1 && p.sd === 2) s += p.s;
    return s;
  }

  private connect() {
    const ws = new WebSocket(`${this.wsUrl}/ws/v1/trading`);
    this.ws = ws;
    this.lastSn = undefined;
    this.epoch++;
    ws.on("open", () => {
      const timestamp = Date.now().toString();
      const nonce = randomBytes(16).toString("base64url");
      const canonical = [this.chainId, "trading-ws-signin", timestamp, nonce].join("\n");
      const sig = ed25519.sign(Buffer.from(canonical), Buffer.from(this.privateKeyHex.replace(/^0x/, ""), "hex"));
      ws.send(
        JSON.stringify({
          mt: 29,
          chain_id: this.chainId,
          api_key: this.apiKey,
          timestamp,
          nonce,
          signature: Buffer.from(sig).toString("base64url"),
        }),
      );
      clearInterval(this.ping);
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ mt: 1, t: Date.now() })), 30_000);
      log("tr.open");
    });
    ws.on("message", (raw) => {
      try {
        this.handle(JSON.parse(raw.toString()));
      } catch (e) {
        log("tr.bad_frame", { error: String(e) });
      }
    });
    ws.on("close", (code, reason) => {
      clearInterval(this.ping);
      log("tr.close", { code, reason: reason.toString() });
      if (!this.stopped) {
        const delay = RETRY_DELAYS[Math.min(this.retry++, RETRY_DELAYS.length - 1)];
        setTimeout(() => !this.stopped && this.connect(), delay);
      }
    });
    ws.on("error", (e) => log("tr.error", { error: String(e) }));
  }

  private handle(m: any) {
    switch (m.mt) {
      case 19: {
        this.retry = 0;
        this.lastSn = m.sn;
        const acc = (m.as ?? [])[0];
        if (acc) this.applyAccount(acc);
        log("tr.wallet", { account: this.accountId, forwarding: this.forwardingAllowed, lfr: this.lfr });
        this.resendInFlight();
        this.ready?.();
        break;
      }
      case 21:
        this.applyAccount(m);
        break;
      case 26:
        this.positions.clear();
      // falls through
      case 27:
        for (const p of m.d ?? []) {
          if (p.st === 1 && p.s > 0) this.positions.set(p.pid, p);
          else this.positions.delete(p.pid);
        }
        this.emit("positions");
        break;
      case 23:
      case 24:
        for (const o of m.d ?? []) this.onOrder(o);
        break;
      case 25:
        for (const f of m.d ?? []) log("tr.fill", { mkt: f.mkt, oid: f.oid, t: f.t, p: f.p, s: f.s, fee: f.f, liquidity: f.l });
        break;
      case 3: {
        const rq = m.cid !== undefined ? this.bySn.get(m.cid) : undefined;
        if (rq === undefined) break;
        if (m.status?.code !== 0) {
          const f = this.inflight.get(rq);
          this.inflight.delete(rq);
          log("tr.rejected", { rq, status: m.status });
          f?.reject(new Error(`gateway rejected order: ${m.status?.code} ${m.status?.error}`));
        }
        break;
      }
      case 100: {
        if (this.lastSn !== undefined && m.sn !== this.lastSn + 1) {
          log("tr.heartbeat_gap", { expected: this.lastSn + 1, got: m.sn });
          this.ws?.close();
          return;
        }
        this.lastSn = m.sn;
        this.head = m.h;
        this.expireInFlight();
        break;
      }
    }
  }

  private applyAccount(a: any) {
    if (a.id !== undefined) this.accountId = a.id;
    if (a.fw !== undefined) this.forwardingAllowed = a.fw;
    if (a.lfr !== undefined) this.lfr = Math.max(this.lfr, Number(a.lfr));
    if (a.b !== undefined) this.balance = BigInt(a.b);
    if (a.lb !== undefined) this.locked = BigInt(a.lb);
  }

  private nextRq() {
    this.localRq = Math.max(this.localRq, this.lfr) + 1;
    return this.localRq;
  }

  /** Place one order and resolve with its first definitive outcome. */
  place(spec: OrderSpec): Promise<OrderOutcome> {
    if (this.accountId === undefined) return Promise.reject(new Error("not signed in"));
    if (!this.forwardingAllowed) return Promise.reject(new Error("order forwarding is off for this account"));
    return new Promise((resolve, reject) => {
      const f: InFlight = { spec, rq: this.nextRq(), sn: 0, lb: 0, reconnectEpoch: this.epoch, retriedNewRq: false, resolve, reject };
      this.send(f);
    });
  }

  private send(f: InFlight) {
    f.sn = ++this.sn;
    f.lb = this.head + this.orderTtl(f.spec.mkt);
    f.reconnectEpoch = this.epoch;
    this.inflight.set(f.rq, f);
    this.bySn.set(f.sn, f.rq);
    const frame = { mt: 22, sn: f.sn, rq: f.rq, acc: this.accountId, lb: f.lb, ...f.spec };
    this.ws?.send(JSON.stringify(frame));
    log("tr.order_sent", frame);
  }

  private onOrder(o: any) {
    if (this.settled.has(o.rq)) return; // first definitive status already processed
    const f = this.inflight.get(o.rq);
    if (!f) return;
    const outcome: OrderOutcome = { rq: o.rq, st: o.st, sr: o.sr, fr: o.fr, fs: o.fs ?? 0, fp: o.fp ?? 0, oid: o.oid, raw: o };
    if (DEFINITIVE.has(o.st)) {
      this.settled.add(o.rq);
      this.inflight.delete(o.rq);
      log("tr.order_done", { rq: o.rq, st: o.st, fs: o.fs, fp: o.fp });
      f.resolve(outcome);
      return;
    }
    if (o.st === FAILED) {
      this.settled.add(o.rq);
      this.inflight.delete(o.rq);
      if (o.sr === SR_REQUEST_ID_TOO_LOW && !f.retriedNewRq) {
        log("tr.retry_new_rq", { old: o.rq, reason: "OrderDescIdTooLow" });
        f.retriedNewRq = true;
        f.rq = this.nextRq();
        this.send(f);
        return;
      }
      log("tr.order_failed", { rq: o.rq, sr: o.sr, fr: o.fr });
      f.resolve(outcome);
    }
  }

  /** Head passed lb with no status and no reconnection since posting: retry once with a new rq. */
  private expireInFlight() {
    for (const f of [...this.inflight.values()]) {
      if (this.head < f.lb) continue;
      this.inflight.delete(f.rq);
      if (f.reconnectEpoch === this.epoch && !f.retriedNewRq) {
        log("tr.retry_new_rq", { old: f.rq, reason: "expired without status" });
        this.settled.add(f.rq);
        f.retriedNewRq = true;
        f.rq = this.nextRq();
        this.send(f);
      } else {
        f.reject(new Error(`order ${f.rq} expired without status`));
      }
    }
  }

  /** After a reconnect, resend still-valid requests with the same rq (at-most-once by rq). */
  private resendInFlight() {
    for (const f of this.inflight.values()) {
      if (this.head > 0 && this.head >= f.lb) continue;
      const frame = { mt: 22, sn: ++this.sn, rq: f.rq, acc: this.accountId, lb: f.lb, ...f.spec };
      this.bySn.set(frame.sn, f.rq);
      this.ws?.send(JSON.stringify(frame));
      log("tr.order_resent", { rq: f.rq });
    }
  }
}
