import "./src/polyfills";
import { BricolageGrotesque_400Regular, BricolageGrotesque_600SemiBold, BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque";
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { client } from "./src/chain";
import { ADDR, vaultAbi } from "./src/contracts";
import { allSeries, holdings, market, vault, wallet, type Holding, type Market, type SeriesView, type VaultView } from "./src/data";
import { Earn } from "./src/screens/Earn";
import { Protect } from "./src/screens/Protect";
import { Trade } from "./src/screens/Trade";
import { You } from "./src/screens/You";
import { Big, Body, Button, C, F, FloorRule, Label } from "./src/ui";
import { createAccount, describeError, signIn, type Session } from "./src/wallet";

type Tab = "Protect" | "Earn" | "Trade" | "You";
const TABS: Tab[] = ["Protect", "Earn", "Trade", "You"];

export default function App() {
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_400Regular,
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_800ExtraBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });
  const [session, setSession] = useState<Session>();
  const [tab, setTab] = useState<Tab>("Protect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const [mkt, setMkt] = useState<Market>();
  const [series, setSeries] = useState<SeriesView[]>([]);
  const [v, setV] = useState<VaultView>();
  const [bal, setBal] = useState({ ausd: 0, mon: 0 });
  const [held, setHeld] = useState<Holding[]>([]);
  const [demoBuyer, setDemoBuyer] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) return;
    const me = session.account.address;
    try {
      const [m, s, vv, b, demo] = await Promise.all([
        market(),
        allSeries(),
        vault(me),
        wallet(me),
        client.readContract({ address: ADDR.vault, abi: vaultAbi, functionName: "isDemoBuyer", args: [me] }),
      ]);
      setMkt(m);
      setSeries(s);
      setV(vv);
      setBal(b);
      setDemoBuyer(demo);
      setHeld(await holdings(me, s));
    } catch (e) {
      setError(describeError(e));
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [session, refresh]);

  async function enter(fn: () => Promise<Session>) {
    setBusy(true);
    setError(undefined);
    try {
      session?.end();
      setSession(await fn());
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.ink }} />;

  if (!session) {
    return (
      <View style={s.welcome}>
        <StatusBar style="light" />
        <Big size={64}>Floorline</Big>
        <FloorRule style={{ marginVertical: 22, width: "62%" }} />
        <Body style={{ fontSize: 19, lineHeight: 27 }}>Protect your MON without selling it. Pay once, set a floor, keep the upside.</Body>
        <Body muted style={{ marginTop: 12 }}>Your account is a passkey on this phone. No seed phrase, no extension.</Body>
        <View style={{ flex: 1 }} />
        <Button title="Create account" onPress={() => enter(createAccount)} busy={busy} />
        <Button title="I already have one" ghost onPress={() => enter(signIn)} busy={busy} />
        {error && <Text style={s.error}>{error}</Text>}
        <Label style={{ marginTop: 18, textAlign: "center" }}>Live on Monad mainnet</Label>
      </View>
    );
  }

  const tabProps = { account: session.account, onDone: refresh };
  return (
    <View style={{ flex: 1, backgroundColor: C.ink }}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={C.floor}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
      >
        {!mkt ? (
          <ActivityIndicator color={C.floor} style={{ marginTop: 80 }} />
        ) : tab === "Protect" ? (
          <Protect {...tabProps} series={series} mkt={mkt} monHeld={bal.mon} demoBuyer={demoBuyer} />
        ) : tab === "Earn" ? (
          <Earn {...tabProps} v={v} ausd={bal.ausd} />
        ) : tab === "Trade" ? (
          <Trade {...tabProps} mkt={mkt} ausd={bal.ausd} />
        ) : (
          <You
            {...tabProps}
            ausd={bal.ausd}
            mon={bal.mon}
            held={held}
            onSignOut={() => {
              session.end();
              setSession(undefined);
            }}
          />
        )}
        {error && <Text style={s.error}>{error}</Text>}
      </ScrollView>
      <View style={s.tabs}>
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={s.tab}>
            <Text style={[s.tabText, tab === t && { color: C.floor }]}>{t}</Text>
            <View style={[s.tabMark, tab === t && { backgroundColor: C.floor }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  welcome: { flex: 1, backgroundColor: C.ink, padding: 24, paddingTop: 96, paddingBottom: 40 },
  page: { padding: 24, paddingTop: 64, paddingBottom: 120 },
  error: { color: C.below, marginTop: 16, fontFamily: F.mono, fontSize: 12 },
  tabs: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    backgroundColor: C.ink,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
    paddingBottom: 22,
    paddingTop: 12,
  },
  tab: { flex: 1, alignItems: "center" },
  tabText: { fontFamily: F.mono, fontSize: 12, color: C.mute, letterSpacing: 1.2, textTransform: "uppercase" },
  tabMark: { height: 2, width: 22, marginTop: 6, backgroundColor: "transparent" },
});
