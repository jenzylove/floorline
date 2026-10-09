import { Text, View, useWindowDimensions } from "react-native";
import type { Holding, Market } from "../data";
import { Action, Big, Body, C, Card, F, Glow, Label, price, untilText, usd } from "../ui";

type Go = (tab: "Protect" | "Earn" | "Trade" | "Wallet") => void;

/** Home: what you have, what you can do, and the floors you hold. Plain words, one question. */
export function Home({ ausd, mon, mkt, held, earnValue, go }: { ausd: number; mon: number; mkt?: Market; held: Holding[]; earnValue: number; go: Go }) {
  const { width } = useWindowDimensions();
  const now = Date.now() / 1000;
  const active = held.filter((h) => !h.series.settled);
  const toCollect = held.filter((h) => h.series.settled && h.payout > 0);
  const total = ausd + earnValue;

  return (
    <View>
      <View style={{ marginHorizontal: -20, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}>
        <Glow width={width} height={340} style={{ left: 0, top: -60 }} />
        <Label>Your money</Label>
        <Big size={54} style={{ marginTop: 4 }}>{usd(total)}</Big>
        <Text style={{ fontFamily: F.body, fontSize: 15, color: C.ink2, marginTop: 6 }}>
          {usd(ausd)} AUSD in your account{earnValue > 0 ? ` · ${usd(earnValue)} earning` : ""} · {mon.toFixed(2)} MON for fees
        </Text>
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

      <Label style={{ marginTop: 6 }}>What do you want to do?</Label>
      <View style={{ marginTop: 6 }}>
        <Action title="Protect my MON" detail="Pay once, set a floor, keep the upside" onPress={() => go("Protect")} icon={<Text style={{ fontSize: 20, color: C.ink }}>⛉</Text>} />
        <Action title="Earn on my AUSD" detail="Back the floors people buy and keep what they pay" onPress={() => go("Earn")} icon={<Text style={{ fontSize: 20, color: C.ink }}>↗</Text>} />
        <Action title="Trade MON" detail="Long or short on Perpl, from your own account" onPress={() => go("Trade")} icon={<Text style={{ fontSize: 20, color: C.ink }}>⇅</Text>} />
        <Action title="Add money" detail="From Base, Arbitrum, Ethereum and more" onPress={() => go("Wallet")} icon={<Text style={{ fontSize: 20, color: C.ink }}>+</Text>} />
      </View>

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
