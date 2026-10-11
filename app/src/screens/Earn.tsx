import { friendly } from "../errors";
import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import type { LocalAccount } from "viem";
import type { VaultView } from "../data";
import { depositEarn, withdrawEarn } from "../tx";
import { Big, Body, Button, C, Card, F, Label, Row, Segment, Title, Trail, usd } from "../ui";

/** Earn: one number (what your deposit is worth), put money in or take it out. The vault's insides are one tap away. */
export function Earn({ account, v, ausd, onDone }: { account: LocalAccount; v?: VaultView; ausd: number; onDone: () => void }) {
  const [mode, setMode] = useState<"in" | "out">("in");
  const [amt, setAmt] = useState("");
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [note, setNote] = useState<string>();
  const [how, setHow] = useState(false);
  // What was put in, remembered on this phone, so the screen can say what the deposit has made in dollars.
  // There is no honest yearly rate to quote for a vault this young, so it shows the real change instead.
  const KEY = `fl-earn-${account.address.toLowerCase()}`;
  const [basis, setBasis] = useState<{ put: number; since: number }>();
  const keep = (b: { put: number; since: number } | undefined) => {
    setBasis(b);
    if (Platform.OS === "web") return;
    (b ? SecureStore.setItemAsync(KEY, JSON.stringify(b)) : SecureStore.deleteItemAsync(KEY)).catch(() => undefined);
  };
  useEffect(() => {
    if (Platform.OS === "web") return;
    SecureStore.getItemAsync(KEY).then((raw) => raw && setBasis(JSON.parse(raw))).catch(() => undefined);
  }, [KEY]);
  useEffect(() => {
    // a deposit made before this was tracked: start counting from what it is worth now
    if (!basis && v && v.myValue > 0.01) keep({ put: v.myValue, since: Date.now() });
  }, [v?.myValue, basis]);
  const made = basis && v ? v.myValue - basis.put : undefined;
  const n = Number(amt);
  const max = mode === "in" ? ausd : (v?.myMaxWithdraw ?? 0);

  async function run() {
    setBusy(true);
    setErr(undefined);
    setNote(undefined);
    setSteps([]);
    const step = (label: string, hash?: string) => setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }]));
    try {
      if (mode === "in") await depositEarn(account, n, step);
      else await withdrawEarn(account, n, step);
      keep(mode === "in" ? { put: (basis?.put ?? v?.myValue ?? 0) + n, since: basis?.since ?? Date.now() } : (basis && basis.put - n > 0.01 ? { put: basis.put - n, since: basis.since } : undefined));
      setNote(mode === "in" ? `${usd(n)} is in. It starts earning now and there is nothing else to do. Check back to watch it grow.` : `${usd(n)} is back in your wallet.`);
      setAmt("");
      onDone();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Title accent="pay you.">Let the floors people buy</Title>
      <Body muted style={{ marginTop: 10 }}>Put in AUSD. It backs the floors people buy, and you keep what they pay.</Body>

      <View style={{ marginTop: 16, gap: 10 }}>
        {[
          ["1", "You put in AUSD."],
          ["2", "People pay to protect their MON. What they pay is shared between depositors like you."],
          ["3", "Your balance here grows as floors are sold. Take it out whenever you like."],
        ].map(([n, t]) => (
          <View key={n} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.limeSoft, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: F.semi, fontSize: 13, color: C.limeInk }}>{n}</Text>
            </View>
            <Body style={{ flex: 1, fontSize: 15 }}>{t}</Body>
          </View>
        ))}
      </View>

      <Card style={{ marginTop: 20 }}>
        <Label>Your deposit is worth</Label>
        <Big size={46} style={{ marginTop: 2 }}>{v ? usd(v.myValue) : "…"}</Big>
        {v && v.myValue > 0 && v.totalAssets > 0 && (
          <Text style={{ fontFamily: F.medium, fontSize: 14, color: C.limeInk, marginTop: 2 }}>
            Earning. You hold {Math.min(100, (v.myValue / v.totalAssets) * 100).toFixed(0)}% of the vault, so you get that share of what buyers pay.
          </Text>
        )}
        {made !== undefined && basis && v && v.myValue > 0.01 && (
          <Text style={{ fontFamily: F.medium, fontSize: 14, color: made < -0.00005 ? C.below : C.ink2, marginTop: 6 }}>
            {made > 0.00005
              ? `Up ${usd(made, 4)} since ${new Date(basis.since).toLocaleDateString()}.`
              : made < -0.00005
                ? `Down ${usd(-made, 4)} since ${new Date(basis.since).toLocaleDateString()}. It moves as open floors are revalued, and comes back if they end unused.`
                : `No change yet since ${new Date(basis.since).toLocaleDateString()}. It moves when floors are sold.`}
          </Text>
        )}
        <Segment items={["in", "out"]} value={mode} onChange={(m) => { setMode(m); setAmt(""); }} render={(m) => (m === "in" ? "Put in" : "Take out")} />
        <TextInput
          value={amt}
          onChangeText={setAmt}
          placeholder="0.00"
          placeholderTextColor={C.mute}
          keyboardType="decimal-pad"
          style={{ fontFamily: F.display, fontSize: 40, color: C.ink, marginTop: 14 }}
        />
        <Pressable onPress={() => setAmt(String(Math.floor(max * 100) / 100))}>
          <Text style={{ fontFamily: F.medium, fontSize: 14, color: C.mute }}>
            {mode === "in" ? `${usd(ausd)} AUSD in your account` : `${usd(max)} you can take out now`} · <Text style={{ color: C.ink, textDecorationLine: "underline" }}>use all</Text>
          </Text>
        </Pressable>
        <Button title={mode === "in" ? "Put in" : "Take out"} onPress={run} disabled={!(n > 0 && n <= max + 1e-9)} busy={busy} />
        {note && <Body style={{ color: C.limeInk, marginTop: 10, fontFamily: F.semi }}>{note}</Body>}
        <Trail steps={steps} />
        {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}
      </Card>

      <Pressable onPress={() => setHow(!how)} style={{ marginTop: 18 }}>
        <Text style={{ fontFamily: F.semi, fontSize: 16, color: C.ink }}>{how ? "Hide the details" : "How it works, and the risk →"}</Text>
      </Pressable>
      {how && v && (
        <View style={{ marginTop: 8 }}>
          <Row k="Owned by depositors" v={usd(v.totalAssets)} />
          <Row k="Locked behind floors" v={usd(v.locked)} />
          <Row k="Value of open floors" v={usd(v.liability)} />
          <Row k="Owed to holders, not collected" v={usd(v.owed)} />
          <Row k="Free to back new floors" v={usd(v.free)} />
          <Row k="Selling floors" v={v.paused ? "paused" : "open"} vColor={v.paused ? C.below : C.limeInk} />
          <Body muted style={{ fontSize: 13, marginTop: 6 }}>Every floor sold has its full payout locked the moment it is bought. You can only take out what is not locked.</Body>
          <Body muted style={{ fontSize: 13, marginTop: 8 }}>What you earn is what buyers pay for their floors. When MON falls below a floor, the payout comes from the vault, so a deposit can go down as well as up. The vault hedges on Perpl to soften that.</Body>
        </View>
      )}
    </View>
  );
}
