import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import type { LocalAccount } from "viem";
import { friendly } from "../errors";
import { KURU, kuruTrade, kuruView, type KuruView } from "../kuru";
import { Big, Body, Button, C, Card, Chips, F, Label, Row, Segment, Title, usd } from "../ui";

const SIZES = [7_000, 10_000, 15_000];
const p6 = (v: number) => `$${v.toFixed(6)}`;

/**
 * Floors on Kuru: the second hand market for protection. Buy a floor someone is selling, or sell one you
 * hold before its end date, on Kuru's Spot V2 order book. Monad testnet, test USDC.
 */
export function FloorMarket({ account }: { account: LocalAccount }) {
  const [v, setV] = useState<KuruView>();
  const [loadErr, setLoadErr] = useState<string>();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [size, setSize] = useState(SIZES[0]);
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [note, setNote] = useState<string>();

  const load = () =>
    kuruView(account.address)
      .then((x) => {
        setV(x);
        setLoadErr(undefined);
      })
      .catch((e) => setLoadErr(friendly(e)));
  useEffect(() => {
    load();
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
  }, [account.address]);

  const best = side === "buy" ? v?.asks[0] : v?.bids[0];
  const cost = best ? size * best.price : 0;
  const haveUsdc = v ? v.usdcWallet + v.usdcKuru : 0;
  const haveFloors = v ? v.floorsWallet + v.floorsKuru : 0;
  const blocker = !v
    ? undefined
    : !best
      ? "Nobody is on that side of the book right now."
      : best.size < size
        ? `Only ${best.size.toLocaleString()} floors rest at the best price. Pick a smaller size.`
        : cost < KURU.minOrderUsd
          ? `Orders here must be at least $${KURU.minOrderUsd}.`
          : v.mon < 0.05
            ? "You need a little testnet MON for the network fee."
            : side === "buy" && haveUsdc < cost * 1.02
              ? "You need test USDC on Monad testnet to buy here."
              : side === "sell" && haveFloors < size
                ? "You don't hold that many floors on testnet yet. Buy some first."
                : undefined;

  async function run() {
    if (!v || !best) return;
    setBusy(true);
    setErr(undefined);
    setNote(undefined);
    setSteps([]);
    try {
      await kuruTrade(account, side, size, best.price, v, (label, hash) => setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }])));
      setNote(side === "buy" ? `You bought ${size.toLocaleString()} floors on Kuru at ${p6(best.price)} each.` : `You sold ${size.toLocaleString()} floors on Kuru at ${p6(best.price)} each.`);
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
        <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.limeInk }}>Kuru Spot V2 · Monad testnet · test USDC</Text>
      </View>
      <Body muted style={{ marginTop: 10 }}>
        A floor is a token, so it can change hands. Buy one someone is selling, or sell yours before its end date, on Kuru's order book.
      </Body>

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
            <Segment items={["buy", "sell"] as ("buy" | "sell")[]} value={side} onChange={setSide} render={(s) => (s === "buy" ? "Buy floors" : "Sell floors")} />
            <Label style={{ marginTop: 14 }}>How many</Label>
            <Chips items={SIZES} value={size} onChange={setSize} render={(n) => n.toLocaleString()} />
            <Row k={side === "buy" ? "You pay about" : "You get about"} v={best ? usd(cost) : "…"} strong />
            <Row k="Each floor protects" v="1 MON below $0.0222" />
            <Button title={side === "buy" ? `Buy ${size.toLocaleString()} floors on Kuru` : `Sell ${size.toLocaleString()} floors on Kuru`} onPress={run} disabled={!!blocker || !best} busy={busy} />
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
            <Row k="Floors" v={haveFloors.toLocaleString(undefined, { maximumFractionDigits: 0 })} strong />
            <Row k="Test USDC" v={usd(haveUsdc)} />
            <Body muted style={{ fontSize: 13, marginTop: 8 }}>
              This market runs on Monad testnet with test money, because that is where Kuru opens new markets. Your real AUSD is not used here.
            </Body>
          </Card>
        </>
      )}
    </View>
  );
}
