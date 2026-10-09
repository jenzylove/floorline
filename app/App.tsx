import "./src/polyfills";
import { Jost_400Regular, Jost_500Medium, Jost_600SemiBold, Jost_700Bold, Jost_800ExtraBold } from "@expo-google-fonts/jost";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import type { Address, LocalAccount } from "viem";
import { client } from "./src/chain";
import { ADDR, vaultAbi } from "./src/contracts";
import { allSeries, holdings, market, vault, wallet, type Holding, type Market, type SeriesView, type VaultView } from "./src/data";
import { Earn } from "./src/screens/Earn";
import { Home } from "./src/screens/Home";
import { Protect } from "./src/screens/Protect";
import { Trade } from "./src/screens/Trade";
import { You } from "./src/screens/You";
import { Body, Button, C, F, Glow, applyTheme, price, usd } from "./src/ui";
import { loadPref, savePref, type ThemePref } from "./src/theme";
import { createAccount, describeError, signIn, type Session } from "./src/wallet";

type Tab = "Home" | "Protect" | "Earn" | "Trade" | "Wallet";
const TABS: Tab[] = ["Home", "Protect", "Earn", "Trade", "Wallet"];
const ICON: Record<Tab, string> = { Home: "⌂", Protect: "⛉", Earn: "↗", Trade: "⇅", Wallet: "◎" };

/**
 * Web preview only (used to screenshot every screen before shipping): ?preview=0xADDRESS shows that
 * address read-only. Nothing can be signed in this mode; on the phone the account is always a passkey.
 */
function previewSession(): Session | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  const a = new URLSearchParams(window.location.search).get("preview");
  if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) return undefined;
  const fail = async () => {
    throw new Error("Preview is read only");
  };
  const account = { address: a as Address, type: "local", source: "preview", publicKey: "0x", signMessage: fail, signTransaction: fail, signTypedData: fail } as unknown as LocalAccount;
  return { account, end: () => undefined };
}

export default function Root() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}

function App() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [fontsLoaded] = useFonts({ Jost_400Regular, Jost_500Medium, Jost_600SemiBold, Jost_700Bold, Jost_800ExtraBold });
  const system = useColorScheme();
  const [pref, setPref] = useState<ThemePref>(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("theme");
      if (t === "light" || t === "dark") return t;
    }
    return "system";
  });
  useEffect(() => {
    if (Platform.OS !== "web") loadPref().then(setPref);
  }, []);
  const scheme: "light" | "dark" = pref === "system" ? (system === "dark" ? "dark" : "light") : pref;
  applyTheme(scheme);
  const s = sty() as any;
  const choosePref = (p: ThemePref) => {
    setPref(p);
    savePref(p);
  };
  const [session, setSession] = useState<Session | undefined>(previewSession);
  const [tab, setTab] = useState<Tab>(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
      if (t && TABS.includes(t)) return t;
    }
    return "Home";
  });
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
      setError(undefined);
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

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  if (!session) {
    return (
      <View key={scheme} style={[s.welcome, { paddingTop: insets.top + 40, paddingBottom: Math.max(insets.bottom, 12) + 24 }]}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Glow width={width} height={520} style={{ left: 0, top: 120 }} />
        <Text style={s.brand}>Floorline</Text>
        <Text style={s.hero}>
          Your MON.{"\n"}
          <Text style={{ color: C.limeInk }}>Protected.</Text>
        </Text>
        <Body style={{ fontSize: 18, lineHeight: 26, marginTop: 14, maxWidth: 340 }}>Pay once, set a floor, keep every bit of the upside.</Body>

        {/* floating widgets, the premium hero */}
        <View style={{ height: 230, marginTop: 26 }}>
          <View style={[s.float, { left: 0, top: 0, transform: [{ rotate: "-3deg" }] }]}>
            <Text style={s.floatK}>You protect</Text>
            <Text style={s.floatV}>10,000 MON</Text>
          </View>
          <View style={[s.float, { right: 0, top: 46, transform: [{ rotate: "2deg" }], backgroundColor: C.ink }]}>
            <Text style={[s.floatK, { color: C.scheme === "dark" ? "#55584D" : "#B9BCB0" }]}>Your floor</Text>
            <Text style={[s.floatV, { color: C.onInk }]}>{price(0.0221)}</Text>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: C.lime, marginTop: 10 }} />
          </View>
          <View style={[s.float, { left: 26, top: 132, transform: [{ rotate: "-1deg" }], backgroundColor: C.limeSoft }]}>
            <Text style={s.floatK}>If MON falls 40%</Text>
            <Text style={[s.floatV, { color: C.limeInk }]}>you get {usd(73.45)}</Text>
          </View>
        </View>
        <Text style={{ fontFamily: F.body, fontSize: 12, color: C.mute }}>Example. Live prices inside.</Text>

        <View style={{ flex: 1 }} />
        <Button title="Create my account" onPress={() => enter(createAccount)} busy={busy} />
        <Button title="I already have one" ghost onPress={() => enter(signIn)} busy={busy} />
        {error && <Text style={s.error}>{error}</Text>}
        <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.mute, textAlign: "center", marginTop: 16 }}>Your fingerprint is your key. No seed phrase · Live on Monad</Text>
      </View>
    );
  }

  const tabProps = { account: session.account, onDone: refresh };
  return (
    <View key={scheme} style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <ScrollView
        contentContainerStyle={[s.page, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={C.ink}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
      >
        {!mkt ? (
          <ActivityIndicator color={C.ink} style={{ marginTop: 80 }} />
        ) : tab === "Home" ? (
          <Home ausd={bal.ausd} mon={bal.mon} mkt={mkt} held={held} earnValue={v?.myValue ?? 0} go={setTab} />
        ) : tab === "Protect" ? (
          <Protect {...tabProps} series={series} mkt={mkt} monHeld={bal.mon} ausd={bal.ausd} demoBuyer={demoBuyer} />
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
            pref={pref}
            onPref={choosePref}
            onSignOut={() => {
              session.end();
              setSession(undefined);
            }}
          />
        )}
        {error && <Text style={s.error}>{error}</Text>}
      </ScrollView>
      <View style={[s.tabs, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={s.tab}>
            <Text style={[s.tabIcon, tab === t && { color: C.ink }]}>{ICON[t]}</Text>
            <Text style={[s.tabText, tab === t && { color: C.ink, fontFamily: F.semi }]}>{t}</Text>
            <View style={[s.tabMark, tab === t && { backgroundColor: C.lime }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const sty = () => ({
  welcome: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 22, overflow: "hidden" },
  brand: { fontFamily: F.semi, fontSize: 18, color: C.ink, letterSpacing: 0.2 },
  hero: { fontFamily: F.displayBlack, fontSize: 54, lineHeight: 56, color: C.ink, letterSpacing: -1.6, marginTop: 34 },
  float: {
    position: "absolute",
    backgroundColor: C.glass,
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 18,
    minWidth: 170,
    shadowColor: C.shadow,
    shadowOpacity: C.scheme === "dark" ? 0.5 : 0.12,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  floatK: { fontFamily: F.medium, fontSize: 13, color: C.mute },
  floatV: { fontFamily: F.display, fontSize: 24, color: C.ink, marginTop: 2, letterSpacing: -0.5 },
  page: { paddingHorizontal: 20 },
  error: { color: C.below, marginTop: 16, fontFamily: F.medium, fontSize: 13 },
  tabs: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: "row",
    backgroundColor: C.glass,
    borderRadius: 28,
    paddingTop: 10,
    shadowColor: C.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  tab: { flex: 1, alignItems: "center" },
  tabIcon: { fontSize: 18, color: C.mute },
  tabText: { fontFamily: F.medium, fontSize: 12, color: C.mute, marginTop: 2 },
  tabMark: { height: 3, width: 18, borderRadius: 2, marginTop: 5, backgroundColor: "transparent" },
});
