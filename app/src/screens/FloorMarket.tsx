import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import type { LocalAccount } from "viem";
import { friendly } from "../errors";
import { type Floor, KURU, floors, kuruTrade, kuruView, ladderTrade, ladderView, minFloors, planFill, type KuruView } from "../kuru";
import { Big, Body, Button, C, Card, Chips, F, Label, Row, Segment, Title, usd } from "../ui";

const p6 = (v: number) => `$${v.toFixed(6)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ends = (t: number) => {
  const d = new Date(t * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`;
};
const strikeText = (f: Floor) => `$${f.strike.toFixed(5).replace(/0+$/, "")}`;

/**
 * Floors on Kuru: the second hand market for protection. Buy a floor someone is selling, or sell one you
 * hold before its end date, on Kuru's Spot V2 order book. Monad testnet, test USDC.
 */
export function FloorMarket({ account }: { account: LocalAccount }) {
  const [list, setList] = useState<Floor[]>([]);
  const [sel, setSel] = useState<Floor>();
  const [v, setV] = useState<KuruView>();
  const [loadErr, setLoadErr] = useState<string>();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("");
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [note, setNote] = useState<string>();

  const viewOf = (f: Floor) => (f.kind === "v2" ? kuruView(account.address) : ladderView(account.address, f));
  const listAt = useRef(0);
  const listRef = useRef<Floor[]>([]);
  const load = async (pick?: Floor) => {
    try {
      // the list of floors changes once a day; refresh it every minute, the chosen book every 12 seconds
      const fresh = Date.now() - listAt.current > 60_000 || listRef.current.length === 0;
      const fs = fresh ? await floors() : listRef.current;
      if (fresh) {
        listAt.current = Date.now();
        listRef.current = fs;
        setList(fs);
      }
      // keep the floor the user picked; default to the flagship market
      const cur = pick ?? sel;
      const f = (cur && fs.find((x) => x.book === cur.book)) ?? fs[0];
      setSel(f);
      setV(await viewOf(f));
      setLoadErr(undefined);
    } catch (e) {
      setLoadErr(friendly(e));
    }
  };
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 12_000);
    return () => clearInterval(t);
  }, [account.address, sel?.book]);
  const choose = (f: Floor) => {
    if (f.book === sel?.book) return;
    setSel(f);
    setV(undefined);
    setAmt("");
    setNote(undefined);
    setErr(undefined);
    setSteps([]);
    viewOf(f).then(setV).catch((e) => setLoadErr(friendly(e)));
  };
  const ladder = sel?.kind === "ladder";

  const levels = v ? (side === "buy" ? v.asks : v.bids) : [];
  const best = levels[0];
  // the flagship market takes $10 and up; ladder books take any size, so start at a round 1,000
  const least = !best ? 0 : ladder ? 1 : minFloors(best.price);
  const onOffer = levels.reduce((a, l) => a + l.size, 0);
  const haveUsdc = v ? v.usdcWallet + v.usdcKuru : 0;
  const haveFloors = v ? v.floorsWallet + v.floorsKuru : 0;
  const size = Math.floor(Number(amt) || 0);
  const plan = planFill(levels, size);
  const cost = plan.usd;
  // quick picks follow the live price, so they are always valid orders
  const picks = (ladder ? [100, 1000, Math.floor(onOffer)] : [least, Math.ceil((least * 2) / 1000) * 1000, Math.floor(onOffer)]).filter((n, i, a) => n > 0 && n <= onOffer && a.indexOf(n) === i);
  useEffect(() => {
    if (!amt && least > 0) setAmt(String(ladder ? Math.min(1000, Math.floor(onOffer)) : least));
  }, [least, sel?.book]);
  const blocker = !v
    ? undefined
    : !best
      ? "Nobody is on that side of the book right now. Check back in a minute."
      : size <= 0
        ? "Type how many floors."
        : size < least
          ? `The smallest order on this market is $${KURU.minOrderUsd}, which is ${least.toLocaleString()} floors at this price. The other floors below take any size.`
          : plan.short
            ? `Only ${Math.floor(onOffer).toLocaleString()} floors are on offer right now. Type a smaller number.`
            : v.mon < 0.05
              ? "You need a little testnet MON for the network fee."
              : side === "buy" && haveUsdc < cost * 1.02
                ? "You don't have enough test USDC for that."
                : side === "sell" && haveFloors < size
                  ? `You hold ${Math.floor(haveFloors).toLocaleString()} floors on testnet. Buy some first, or type a smaller number.`
                  : undefined;

  async function run() {
    if (!v || !best || !sel) return;
    setBusy(true);
    setErr(undefined);
    setNote(undefined);
    setSteps([]);
    try {
      const step = (label: string, hash?: string) => setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }]));
      if (sel.kind === "ladder") await ladderTrade(account, sel, side, size, plan.usd, step);
      else await kuruTrade(account, side, size, plan.limit, plan.usd, v, step);
      setNote(side === "buy" ? `You bought ${size.toLocaleString()} floors on Kuru for about ${usd(cost)}.` : `You sold ${size.toLocaleString()} floors on Kuru for about ${usd(cost)}.`);
      await load();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Title accent="on Kuru.">Buy or sell a floor,</Title>
      <View style={{ alignSelf: "flex-start", backgroundColor: C.limeSoft, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14, marginTop: 16 }}>
        <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.limeInk }}>Kuru · Monad testnet · test USDC</Text>
      </View>
      <Body muted style={{ marginTop: 10 }}>
        A floor is a token, so it can change hands. Every floor below has its own order book on Kuru. New ones open each day at today's MON price.
      </Body>

      {list.length > 0 && (
        <Card style={{ marginTop: 16 }}>
          <Label>Pick a floor</Label>
          {list.map((f) => {
            const on = f.book === sel?.book;
            return (
              <Pressable key={f.book} onPress={() => choose(f)} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, marginTop: 6, borderRadius: 14, backgroundColor: on ? C.limeSoft : "transparent" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.ink }}>MON below {strikeText(f)}</Text>
                  <Text style={{ fontFamily: F.medium, fontSize: 12, color: C.mute, marginTop: 2 }}>
                    {f.kind === "v2" ? "Kuru Spot V2 market" : f.days === 1 ? "1 day floor" : "1 week floor"} · ends {ends(f.expiry)}
                  </Text>
                </View>
                <Text style={{ fontFamily: F.semi, fontSize: 13, color: on ? C.limeInk : C.ink2 }}>{f.bestAsk ? p6(f.bestAsk) : f.kind === "v2" ? "flagship" : "…"}</Text>
              </Pressable>
            );
          })}
        </Card>
      )}

      {loadErr && <Body style={{ color: C.below, marginTop: 12 }}>{loadErr}</Body>}
      {!v && !loadErr && <Body muted style={{ marginTop: 16 }}>Reading the order book…</Body>}

      {v && (
        <>
          <Card style={{ marginTop: 16 }}>
            <Label>One floor costs</Label>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
              <View>
                <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.mute }}>to buy on Kuru</Text>
                <Big size={26} color={C.limeInk}>{v.asks[0] ? p6(v.asks[0].price) : "none"}</Big>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.mute }}>to sell on Kuru</Text>
                <Big size={26}>{v.bids[0] ? p6(v.bids[0].price) : "none"}</Big>
              </View>
            </View>
            {v.mint > 0 && (
              <Body muted style={{ fontSize: 13, marginTop: 8 }}>
                The vault mints a new one at {p6(v.mint)}. {v.asks[0] && v.asks[0].price <= v.mint ? "Buying here is cheaper than minting." : ""}
              </Body>
            )}

            <Label style={{ marginTop: 16 }}>The order book, live</Label>
            <View style={{ flexDirection: "row", gap: 18, marginTop: 6 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.medium, fontSize: 12, color: C.mute }}>Buyers</Text>
                {v.bids.slice(0, 3).map((l) => (
                  <View key={`b${l.price}`} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
                    <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.ink2 }}>{l.size.toLocaleString()}</Text>
                    <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.ink }}>{p6(l.price)}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.medium, fontSize: 12, color: C.mute }}>Sellers</Text>
                {v.asks.slice(0, 3).map((l) => (
                  <View key={`a${l.price}`} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
                    <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.ink2 }}>{l.size.toLocaleString()}</Text>
                    <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.limeInk }}>{p6(l.price)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </Card>

          <Card style={{ marginTop: 14 }}>
            <Segment items={["buy", "sell"] as ("buy" | "sell")[]} value={side} onChange={(x) => { setSide(x); setAmt(""); }} render={(s) => (s === "buy" ? "Buy floors" : "Sell floors")} />
            <Label style={{ marginTop: 14 }}>How many floors</Label>
            <TextInput
              value={amt}
              onChangeText={(t) => setAmt(t.replace(/[^0-9]/g, ""))}
              placeholder={least ? String(least) : "0"}
              placeholderTextColor={C.mute}
              keyboardType="number-pad"
              style={{ fontFamily: F.display, fontSize: 40, color: C.ink, marginTop: 4, letterSpacing: -1 }}
            />
            <Chips items={picks} value={size} onChange={(n) => setAmt(String(n))} render={(n) => (n === least ? `Smallest · ${n.toLocaleString()}` : n === Math.floor(onOffer) ? `All on offer · ${n.toLocaleString()}` : n.toLocaleString())} />
            {side === "sell" && haveFloors >= least && (
              <Pressable onPress={() => setAmt(String(Math.floor(Math.min(haveFloors, onOffer))))} style={{ marginTop: 10 }}>
                <Text style={{ fontFamily: F.medium, fontSize: 14, color: C.mute }}>
                  You hold {Math.floor(haveFloors).toLocaleString()} · <Text style={{ color: C.ink, textDecorationLine: "underline" }}>sell all</Text>
                </Text>
              </Pressable>
            )}
            <Row k={side === "buy" ? "You pay about" : "You get about"} v={best && size > 0 ? usd(cost) : "…"} strong />
            {best && size > 0 && plan.limit !== best.price && <Row k="Average price" v={p6(cost / Math.max(1, plan.floors))} />}
            <Row k="Each floor protects" v={sel ? `1 MON below ${strikeText(sel)}` : "…"} />
            {sel && <Row k="Until" v={ends(sel.expiry)} />}
            <Button title={size > 0 ? (side === "buy" ? `Buy ${size.toLocaleString()} floors on Kuru` : `Sell ${size.toLocaleString()} floors on Kuru`) : side === "buy" ? "Buy on Kuru" : "Sell on Kuru"} onPress={run} disabled={!!blocker || !best} busy={busy} />
            {blocker && <Body muted style={{ fontSize: 14, marginTop: 8 }}>{blocker}</Body>}
            {note && <Body style={{ color: C.limeInk, fontFamily: F.semi, marginTop: 10 }}>{note}</Body>}
            {steps.map((st, i) => (
              <Pressable key={i} disabled={!st.hash} onPress={() => st.hash && Linking.openURL(`${KURU.explorer}/tx/${st.hash}`)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: st.hash ? C.lime : C.line }} />
                <Text style={{ flex: 1, fontFamily: F.medium, fontSize: 14, color: C.ink }}>{st.label}</Text>
                <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.mute }}>{st.hash ? `${st.hash.slice(0, 8)}…${st.hash.slice(-4)} ↗` : "confirm with your fingerprint"}</Text>
              </Pressable>
            ))}
            {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}
          </Card>

          <Card style={{ marginTop: 14 }}>
            <Label>Yours on testnet</Label>
            <Row k={sel ? `Floors below ${strikeText(sel)}` : "Floors"} v={haveFloors.toLocaleString(undefined, { maximumFractionDigits: 0 })} strong />
            <Row k="Test USDC" v={usd(haveUsdc)} />
            <Body muted style={{ fontSize: 13, marginTop: 8 }}>
              These markets run on Monad testnet with test money, because that is where Kuru opens new markets. Your real AUSD is not used here.
            </Body>
          </Card>
        </>
      )}
    </View>
  );
}
