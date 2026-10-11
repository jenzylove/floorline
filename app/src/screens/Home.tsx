import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { Holding, Market } from "../data";
import { Action, Big, Body, C, Card, F, Glow, Label, price, untilText, usd } from "../ui";

type Go = (tab: "Protect" | "Earn" | "Trade" | "Wallet") => void;

/** Home: what you have, what you can do, and the floors you hold. Plain words, one question. */
export function Home({ ausd, mon, mkt, held, earnValue, tradeValue, loaded, go }: { ausd: number; mon: number; mkt?: Market; held: Holding[]; earnValue: number; tradeValue: number; loaded: boolean; go: Go }) {
  const { width } = useWindowDimensions();
  const now = Date.now() / 1000;
  const active = held.filter((h) => !h.series.settled);
  const toCollect = held.filter((h) => h.series.settled && h.payout > 0);
  const total = ausd + earnValue + tradeValue;
  // the short guide stays until the person says they have it
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    if (Platform.OS === "web") return setGuide(true);
    SecureStore.getItemAsync("fl-guide-seen").then((v) => setGuide(v !== "1")).catch(() => setGuide(true));
  }, []);
  const gotIt = () => {
    setGuide(false);
    if (Platform.OS !== "web") SecureStore.setItemAsync("fl-guide-seen", "1").catch(() => undefined);
  };
  const empty = loaded && total < 0.5 && held.length === 0;

  return (
    <View>
      <View style={{ marginHorizontal: -20, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}>
        <Glow width={width} height={340} style={{ left: 0, top: -60 }} />
        <Label>Your money</Label>
        <Big size={54} style={{ marginTop: 4 }}>{loaded ? usd(total) : "…"}</Big>
        {loaded ? (
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.ink2, marginTop: 6 }}>
            {usd(ausd)} in your wallet{earnValue > 0 ? ` · ${usd(earnValue)} earning` : ""}{tradeValue > 0 ? ` · ${usd(tradeValue)} in trading` : ""} · {mon.toFixed(2)} MON for fees
          </Text>
        ) : (
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.mute, marginTop: 6 }}>Reading your account…</Text>
        )}
        {mkt && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.lime }} />
            <Text style={{ fontFamily: F.medium, fontSize: 14, color: C.ink }}>MON {price(mkt.spot)}</Text>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: C.mute }}>live on Perpl</Text>
          </View>
        )}
      </View>

      {toCollect.length > 0 && (
        <Card tint="lime" style={{ marginBottom: 14 }}>
          <Text style={{ fontFamily: F.semi, fontSize: 17, color: C.ink }}>Your floor paid out</Text>
          <Body style={{ marginTop: 4 }}>
            {usd(toCollect.reduce((a, h) => a + h.payout, 0), 4)} is ready to collect in Wallet.
          </Body>
        </Card>
      )}

      {guide && (
        <Card style={{ marginBottom: 16 }}>
          <Text style={{ fontFamily: F.semi, fontSize: 18, color: C.ink }}>New here? Three things you can do</Text>
          {[
            ["Protect", "Worried MON will drop? Pay once and pick a price. If MON ends below it, you get the difference back in dollars. If it rises, you keep the gain."],
            ["Earn", "Have dollars sitting idle? Put AUSD in and collect what people pay for their protection."],
            ["Trade", "Have a view? Bet on MON going up or down on Perpl."],
          ].map(([k, t]) => (
            <View key={k} style={{ marginTop: 12 }}>
              <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.limeInk }}>{k}</Text>
              <Body style={{ fontSize: 14, marginTop: 2 }}>{t}</Body>
            </View>
          ))}
          <Body muted style={{ fontSize: 13, marginTop: 12 }}>AUSD is a digital dollar: 1 AUSD is 1 US dollar. MON is Monad's coin, and a little of it pays the network fees.</Body>
          <Pressable onPress={gotIt} style={{ marginTop: 14, alignSelf: "flex-start", backgroundColor: C.ink, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20 }}>
            <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.onInk }}>Got it</Text>
          </Pressable>
        </Card>
      )}

      {empty && (
        <Card tint="lime" style={{ marginBottom: 16 }}>
          <Text style={{ fontFamily: F.semi, fontSize: 17, color: C.ink }}>Start by adding money</Text>
          <Body style={{ marginTop: 4, fontSize: 14 }}>Bring dollars in from Base, Arbitrum, Ethereum and more. It lands here in about a minute.</Body>
          <Pressable onPress={() => go("Wallet")} style={{ marginTop: 12, alignSelf: "flex-start", backgroundColor: C.ink, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20 }}>
            <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.onInk }}>Add money</Text>
          </Pressable>
        </Card>
      )}

      <Label style={{ marginTop: 6 }}>What do you want to do?</Label>
      <View style={{ marginTop: 6 }}>
        <Action title="Protect my MON" detail="Pay once so your MON can't lose below a price you pick" onPress={() => go("Protect")} icon={<Text style={{ fontSize: 20, color: C.ink }}>⛉</Text>} />
        <Action title="Earn on my AUSD" detail="Put dollars in and collect what protectors pay" onPress={() => go("Earn")} icon={<Text style={{ fontSize: 20, color: C.ink }}>↗</Text>} />
        <Action title="Trade MON" detail="Bet on MON going up or down, on Perpl" onPress={() => go("Trade")} icon={<Text style={{ fontSize: 20, color: C.ink }}>⇅</Text>} />
        <Action title="Add money" detail="From Base, Arbitrum, Ethereum and more" onPress={() => go("Wallet")} icon={<Text style={{ fontSize: 20, color: C.ink }}>+</Text>} />
      </View>

      {!guide && (
        <Pressable onPress={() => setGuide(true)} style={{ marginTop: 18 }}>
          <Text style={{ fontFamily: F.medium, fontSize: 14, color: C.mute }}>New here? See what you can do →</Text>
        </Pressable>
      )}

      <Label style={{ marginTop: 22 }}>Your floors</Label>
      {active.length === 0 ? (
        <Body muted style={{ marginTop: 8 }}>None yet. Your first floor takes about a minute.</Body>
      ) : (
        active.map((h) => (
          <Card key={h.series.id} style={{ marginTop: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: F.semi, fontSize: 17, color: C.ink }}>{h.units.toLocaleString()} MON</Text>
              <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.mute }}>{untilText(h.series.expiry - now)} left</Text>
            </View>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: C.lime, marginVertical: 12 }} />
            <Text style={{ fontFamily: F.body, fontSize: 14, color: C.ink2 }}>
              Protected below {price(h.series.strike)}
              {mkt ? (mkt.spot >= h.series.strike ? " · MON is above your floor" : ` · pays ${usd((h.series.strike - mkt.spot) * h.units, 4)} if it ends here`) : ""}
            </Text>
          </Card>
        ))
      )}
    </View>
  );
}
