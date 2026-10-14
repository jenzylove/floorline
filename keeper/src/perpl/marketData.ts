import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { Book, type Level } from "./book.js";
import { log } from "../log.js";

export interface MarketState {
  block: number;
  oracle: number;
  mark: number;
  bid: number;
  ask: number;
}

export interface Funding {
  rate: number; // per Perpl's FundingEvent
  block: number;
}

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];

/**
 * Perpl public market-data WebSocket: heartbeat, market state, funding and L2 books.
 * Batches every subscription into one frame (10 requests/min budget), checks heartbeat sequence
 * numbers and reconnects with backoff on any gap or close.
 */
export class MarketData extends EventEmitter {
  head = 0;
  states = new Map<number, MarketState>();
  funding = new Map<number, Funding>();
  books = new Map<number, Book>();
  private ws?: WebSocket;
  private lastSn?: number;
  private retry = 0;
  private bookSid = new Map<number, number>();
  private stopped = false;

  constructor(
    private wsUrl: string,
    private chainId: number,
    private markets: number[],
  ) {
    super();
    for (const m of markets) this.books.set(m, new Book());
  }

  private watchdog?: ReturnType<typeof setInterval>;
  private lastFrameAt = Date.now();

  start() {
    this.stopped = false;
    this.connect();
    // A stream can go quiet without closing (seen on 14 Oct: no frames for minutes, no close event). The
    // heartbeat arrives every block, so 30 seconds of silence means the socket is dead: drop it and reconnect.
    this.watchdog = setInterval(() => {
      if (this.stopped || !this.connected) return;
      if (Date.now() - this.lastFrameAt > 30_000) {
        log("md.stale", { silentMs: Date.now() - this.lastFrameAt });
        this.ws?.terminate();
      }
    }, 10_000);
  }

  stop() {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.ws?.close();
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect() {
    const ws = new WebSocket(`${this.wsUrl}/ws/v1/market-data`);
    this.ws = ws;
    this.lastSn = undefined;
    this.lastFrameAt = Date.now();
    ws.on("open", () => {
      this.retry = 0;
      const subs = [
        { stream: `heartbeat@${this.chainId}`, subscribe: true },
        { stream: `market-state@${this.chainId}`, subscribe: true },
        { stream: `funding@${this.chainId}`, subscribe: true },
        ...this.markets.map((m) => ({ stream: `order-book@${m}`, subscribe: true })),
      ];
      ws.send(JSON.stringify({ mt: 5, subs }));
      log("md.open", { streams: subs.map((s) => s.stream) });
    });
    ws.on("message", (raw) => {
      this.lastFrameAt = Date.now();
      try {
        this.handle(JSON.parse(raw.toString()));
      } catch (e) {
        log("md.bad_frame", { error: String(e) });
      }
    });
    ws.on("close", (code) => {
      log("md.close", { code });
      if (!this.stopped) this.reconnect();
    });
    ws.on("error", (e) => log("md.error", { error: String(e) }));
  }

  private reconnect() {
    const delay = RETRY_DELAYS[Math.min(this.retry++, RETRY_DELAYS.length - 1)];
    setTimeout(() => !this.stopped && this.connect(), delay);
  }

  private handle(m: any) {
    switch (m.mt) {
      case 6:
        for (const s of m.subs ?? []) {
          if (s.status?.code !== 0) log("md.sub_failed", { stream: s.stream, status: s.status });
          const ob = /^order-book@(\d+)$/.exec(s.stream);
          if (ob && s.sid) this.bookSid.set(s.sid, Number(ob[1]));
        }
        break;
      case 100: {
        if (this.lastSn !== undefined && m.sn !== this.lastSn + 1) {
          log("md.heartbeat_gap", { expected: this.lastSn + 1, got: m.sn });
          this.ws?.close(); // reconnect for fresh snapshots
          return;
        }
        this.lastSn = m.sn;
        this.head = m.h;
        this.emit("head", m.h);
        break;
      }
      case 9:
        for (const [id, s] of Object.entries<any>(m.d ?? {})) {
          if (!s) continue;
          this.states.set(Number(id), { block: s.at?.b ?? 0, oracle: s.orl, mark: s.mrk, bid: s.bid, ask: s.ask });
        }
        this.emit("state");
        break;
      case 10:
        for (const [id, f] of Object.entries<any>(m.d ?? {})) {
          if (f) this.funding.set(Number(id), { rate: f.rate, block: f.at?.b ?? 0 });
        }
        break;
      case 15:
      case 16: {
        const market = this.bookSid.get(m.sid);
        if (market === undefined) return;
        const book = this.books.get(market)!;
        if (m.mt === 15) book.snapshot(m.bid as Level[], m.ask as Level[], m.at?.b ?? 0);
        else book.update(m.bid as Level[], m.ask as Level[], m.at?.b ?? 0);
        break;
      }
    }
  }
}
