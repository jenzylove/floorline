import "./src/polyfills";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { verifyMessage } from "viem";
import { balances } from "./src/chain";
import { createAccount, describeError, RP_ID, signIn, type Session } from "./src/wallet";

/** Spike screen: prove a Mera passkey account works on this phone. Every value shown is read live. */
export default function App() {
  const [session, setSession] = useState<Session>();
  const [bal, setBal] = useState<{ mon: string; ausd: string }>();
  const [sig, setSig] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(fn: () => Promise<Session>) {
    setBusy(true);
    setError(undefined);
    try {
      session?.end();
      const s = await fn();
      setSession(s);
      setBal(await balances(s.account.address));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function signTest() {
    if (!session) return;
    setBusy(true);
    try {
      const message = `Floorline passkey test ${new Date().toISOString()}`;
      const signature = await session.account.signMessage({ message });
      const ok = await verifyMessage({ address: session.account.address, message, signature });
      setSig(`${ok ? "verified" : "NOT verified"}: ${signature.slice(0, 18)}…`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.page}>
      <StatusBar style="light" />
      <Text style={s.h1}>Floorline</Text>
      <View style={s.floor} />
      <Text style={s.muted}>Mera passkey spike. Passkey domain: {RP_ID}</Text>

      <Pressable style={s.btn} disabled={busy} onPress={() => run(createAccount)}>
        <Text style={s.btnText}>Create account with passkey</Text>
      </Pressable>
      <Pressable style={[s.btn, s.btn2]} disabled={busy} onPress={() => run(signIn)}>
        <Text style={s.btnText2}>Sign in with passkey</Text>
      </Pressable>
      {busy && <ActivityIndicator color="#d8ff3d" style={{ marginTop: 16 }} />}

      {session && (
        <View style={s.card}>
          <Text style={s.label}>Address (Monad mainnet)</Text>
          <Text style={s.value} selectable>{session.account.address}</Text>
          <Text style={s.label}>AUSD</Text>
          <Text style={s.big}>{bal ? bal.ausd : "…"}</Text>
          <Text style={s.label}>MON</Text>
          <Text style={s.value}>{bal ? bal.mon : "…"}</Text>
          <Pressable style={[s.btn, s.btn2]} disabled={busy} onPress={signTest}>
            <Text style={s.btnText2}>Sign a test message</Text>
          </Pressable>
          {sig && <Text style={s.value}>{sig}</Text>}
        </View>
      )}
      {error && <Text style={s.error}>{error}</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: "#0e0f0c", padding: 24, paddingTop: 72 },
  h1: { color: "#f2efe6", fontSize: 48, fontWeight: "700", letterSpacing: -1 },
  floor: { height: 2, backgroundColor: "#d8ff3d", marginVertical: 20 },
  muted: { color: "#9b978c", fontSize: 14, marginBottom: 24 },
  btn: { backgroundColor: "#d8ff3d", paddingVertical: 16, borderRadius: 14, alignItems: "center", marginTop: 12 },
  btn2: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#d8ff3d" },
  btnText: { color: "#0e0f0c", fontWeight: "700", fontSize: 16 },
  btnText2: { color: "#d8ff3d", fontWeight: "700", fontSize: 16 },
  card: { marginTop: 28 },
  label: { color: "#9b978c", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, marginTop: 16 },
  value: { color: "#f2efe6", fontSize: 15, marginTop: 4 },
  big: { color: "#f2efe6", fontSize: 40, fontWeight: "700", marginTop: 4 },
  error: { color: "#ff7a59", marginTop: 20, fontSize: 14 },
});
