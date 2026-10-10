// Floorline web: every number on these pages is read live from Monad mainnet, Perpl's public API or the
// Envio indexer. Nothing is cached, staged or made up. Shared by /, /demo and /proof.
import { createPublicClient, http, parseAbi, defineChain } from "https://esm.sh/viem@2.57.2";

export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
});
export const client = createPublicClient({ chain: monad, transport: http() });

export const ADDR = {
  vault: "0x2286f16a97e592D2C90C31e3ae56E3F4A9ec5dB4",
  volFeed: "0x1820045B9a1366d7a8aB8715cf9607f0C3635c6d",
  priceSource: "0x0E21C63a335344Db44938C02170374302e7b0b77",
  creReceiver: "0x25541C105A727BFc266509cCdbA1327F2c0a6895",
  perpl: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
};
export const ENVIO = "https://indexer.dev.hyperindex.xyz/194cebd/v1/graphql";
export const PERPL_API = "https://app.perpl.xyz/api";
export const APK = "https://github.com/jenzylove/floorline/releases/latest/download/floorline.apk";
export const tx = (h) => `https://monadscan.com/tx/${h}`;
export const addr = (a) => `https://monadscan.com/address/${a}`;

const vaultAbi = parseAbi([
  "function quote(uint256 seriesId, uint256 amount) view returns (uint256)",
  "function seriesCount() view returns (uint256)",
  "function getSeries(uint256) view returns ((uint256 marketId, uint256 strike, uint64 expiry, bool settled, address token, uint256 locked, uint256 payoutPerToken, uint256 settlePrice, uint256 owed))",
  "function isShortTenor(uint256) view returns (bool)",
  "function totalAssets() view returns (uint256)",
  "function totalLocked() view returns (uint256)",
  "function freeAssets() view returns (uint256)",
  "function openLiability() view returns (uint256)",
  "function totalOwed() view returns (uint256)",
]);
const pxAbi = parseAbi(["function price(uint256) view returns (uint256, uint256)", "function mark(uint256) view returns (uint256, uint256)"]);
const volAbi = parseAbi(["function get(uint256) view returns (uint256, uint256)", "function getObserved(uint256) view returns (uint256, uint256)"]);

const n6 = (x) => Number(x) / 1e6;
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });

export async function market() {
  const [[p, pAt], [v, vAt], [ov, ovAt]] = await Promise.all([
    read(ADDR.priceSource, pxAbi, "price", [10n]),
    read(ADDR.volFeed, volAbi, "get", [10n]),
    read(ADDR.volFeed, volAbi, "getObserved", [10n]),
  ]);
  return { spot: n6(p), spotAt: Number(pAt), vol: Number(v) / 1e18, volAt: Number(vAt), observed: Number(ov) / 1e18, observedAt: Number(ovAt) };
}

export async function vault() {
  const [ta, lk, fr, li, ow] = await Promise.all(["totalAssets", "totalLocked", "freeAssets", "openLiability", "totalOwed"].map((f) => read(ADDR.vault, vaultAbi, f)));
  return { totalAssets: n6(ta), locked: n6(lk), free: n6(fr), liability: n6(li), owed: n6(ow) };
}

/** Open series a member of the public can buy (not settled, not in their last minute, not demo-only). */
export async function openSeries() {
  const count = Number(await read(ADDR.vault, vaultAbi, "seriesCount"));
  const now = Date.now() / 1000;
  const all = await Promise.all(
    Array.from({ length: count }, async (_, id) => {
      const [s, short] = await Promise.all([read(ADDR.vault, vaultAbi, "getSeries", [BigInt(id)]), read(ADDR.vault, vaultAbi, "isShortTenor", [BigInt(id)])]);
      return { id, strike: n6(s.strike), expiry: Number(s.expiry), settled: s.settled, token: s.token, locked: n6(s.locked), short };
    }),
  );
  return all.filter((s) => !s.settled && !s.short && s.expiry - now > 90).sort((a, b) => a.expiry - b.expiry || b.strike - a.strike);
}

export async function quote(seriesId, units) {
  try {
    const q = await read(ADDR.vault, vaultAbi, "quote", [BigInt(seriesId), BigInt(Math.round(units * 1e6)) * 10n ** 12n]);
    return { premium: n6(q) };
  } catch (e) {
    const m = String(e?.shortMessage || e?.message || e);
    if (m.includes("6fb3b185") || m.includes("StalePrice")) return { error: "The price feed is catching up, a new quote follows in seconds." };
    if (m.includes("PriceDisagreement")) return { error: "The market just moved faster than the price feed. Retrying." };
    return { error: m.split("\n")[0].slice(0, 140) };
  }
}

export async function candles(hours = 24, sec = 300) {
  const to = Date.now();
  const res = await fetch(`${PERPL_API}/v1/market-data/10/candles/${sec}/${to - hours * 3600e3}-${to}`);
  if (!res.ok) throw new Error(`Perpl candles HTTP ${res.status}`);
  return (await res.json()).d.filter((d) => d.c > 0).map((d) => ({ t: d.t, c: d.c / 1e6 }));
}

export async function gql(query) {
  const res = await fetch(ENVIO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const j = await res.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}

// ---------------------------------------------------------------- formatting and the floor chart

export const usd = (v, dp = 2) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const price = (v) => `$${Number(v).toFixed(v < 1 ? 5 : 2)}`;
export const pct = (v, dp = 0) => `${(v * 100).toFixed(dp)}%`;
export function until(sec) {
  if (sec <= 0) return "expired";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
export function ago(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}
export function floorLabel(s, spot) {
  const below = 1 - s.strike / spot;
  const where = Math.abs(below) < 0.01 ? "today's price" : below > 0 ? `${Math.round(below * 100)}% below` : `${Math.round(-below * 100)}% above`;
  return `${where} · ${until(s.expiry - Date.now() / 1000)}`;
}

/** MON's real price over the last day, with floors drawn across it. The chosen floor is lit. */
export function drawChart(svg, data, floors = [], lit) {
  const w = svg.clientWidth || 800, h = svg.clientHeight || 260;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  if (data.length < 2) return;
  const ys = data.map((d) => d.c);
  let lo = Math.min(...ys, ...floors), hi = Math.max(...ys);
  const pad = (hi - lo) * 0.14 || hi * 0.02;
  lo -= pad; hi += pad;
  const x = (i) => (i / (data.length - 1)) * w;
  const y = (v) => h - ((v - lo) / (hi - lo)) * h;
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.c).toFixed(1)}`).join(" ");
  let out = `<defs><linearGradient id="fa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--bone);stop-opacity:.10"/><stop offset="1" style="stop-color:var(--bone);stop-opacity:0"/></linearGradient>
    <linearGradient id="fc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--floor);stop-opacity:.24"/><stop offset="1" style="stop-color:var(--floor);stop-opacity:.02"/></linearGradient></defs>
    <path d="${path} L${w},${h} L0,${h} Z" fill="url(#fa)"/>`;
  for (const f of floors) {
    if (f === lit) continue;
    out += `<line x1="0" x2="${w}" y1="${y(f)}" y2="${y(f)}" style="stroke:var(--bone);stroke-opacity:.22;stroke-dasharray:3 6"/>`;
  }
  if (lit !== undefined) {
    out += `<rect x="0" y="${y(lit)}" width="${w}" height="${Math.max(0, h - y(lit))}" fill="url(#fc)"/>
      <line class="lit" x1="0" x2="${w}" y1="${y(lit)}" y2="${y(lit)}" style="stroke:var(--floor);stroke-width:2"/>
      <text x="${w - 6}" y="${y(lit) - 8}" style="fill:var(--floorInk)" font-family="Jost" font-weight="600" font-size="13" text-anchor="end">FLOOR ${price(lit)}</text>`;
  }
  // the trace animation plays on the first draw only, not on every live refresh
  const first = !svg.dataset.drawn;
  svg.dataset.drawn = "1";
  out += `<path class="price${first ? " trace" : ""}" d="${path}" style="fill:none;stroke:var(--bone);stroke-width:1.6"/>`;
  const last = data[data.length - 1];
  out += `<circle cx="${x(data.length - 1)}" cy="${y(last.c)}" r="4" style="fill:var(--bone)"><animate attributeName="r" values="4;7;4" dur="2s" repeatCount="indefinite"/></circle>`;
  svg.innerHTML = out;
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** A short menu a person can read: for a day and for a week, the floor at today's price and the two nearest steps below it. */
export function shortlist(series, spot) {
  const now = Date.now() / 1000;
  const pick = (list) => {
    const seen = new Set();
    return list
      .filter((s) => s.strike <= spot * 1.01)
      .sort((a, b) => b.strike - a.strike || b.expiry - a.expiry)
      .filter((s) => { const k = Math.round((1 - s.strike / spot) * 20); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 3);
  };
  const day = pick(series.filter((s) => s.expiry - now <= 2 * 86400));
  const week = pick(series.filter((s) => s.expiry - now > 2 * 86400));
  return { day, week, all: [...day, ...week] };
}

// The Floorline market on Kuru's order book (Monad testnet). A keeper quotes both sides around the vault's price.
export const KURU = {
  rpc: "https://testnet-rpc.monad.xyz",
  book: "0x75E4f0ae3F8C1Be093eFe08818770d034d4103C8",
  vault: "0x25541C105A727BFc266509cCdbA1327F2c0a6895",
  explorer: "https://testnet.monadscan.com",
};
const testnet = createPublicClient({ transport: http(KURU.rpc) });
const kuruAbi = parseAbi(["function getL2Book() view returns (bytes)"]);
const kuruVaultAbi = parseAbi(["function quote(uint256 seriesId, uint256 amount) view returns (uint256)"]);

/** Bids and asks resting on the book right now, and the vault's own price for one token. */
export async function kuruBook() {
  const [data, premium] = await Promise.all([
    testnet.readContract({ address: KURU.book, abi: kuruAbi, functionName: "getL2Book" }),
    testnet.readContract({ address: KURU.vault, abi: kuruVaultAbi, functionName: "quote", args: [0n, 1000n * 10n ** 18n] }),
  ]);
  // layout: block number, then (price, size) pairs for bids until a zero price, then the same for asks
  const word = (i) => BigInt("0x" + data.slice(2 + i * 64, 2 + (i + 1) * 64));
  const words = (data.length - 2) / 64;
  const side = (i) => {
    const out = [];
    while (i + 1 < words) {
      const price = word(i);
      if (price === 0n) return [out, i + 1];
      out.push({ price: Number(price) / 1e6, size: Number(word(i + 1)) / 1e6 });
      i += 2;
    }
    return [out, i];
  };
  const [bids, next] = side(1);
  const [asks] = side(next);
  return { bids: bids.sort((a, b) => b.price - a.price), asks: asks.sort((a, b) => a.price - b.price), mint: Number(premium) / 1e6 / 1000 };
}
