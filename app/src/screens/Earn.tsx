import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
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
  const [how, setHow] = useState(false);
  const n = Number(amt);
  const max = mode === "in" ? ausd : (v?.myMaxWithdraw ?? 0);

  async function run() {
    setBusy(true);
    setErr(undefined);
    setSteps([]);
    const step = (label: string, hash?: string) => setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }]));
    try {
      if (mode === "in") await depositEarn(account, n, step);
      else await withdrawEarn(account, n, step);
      setAmt("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Title accent="pay you.">Let the floors people buy</Title>
      <Body muted style={{ marginTop: 10 }}>Put in AUSD. It backs the floors people buy, and you keep what they pay.</Body>

      <Card style={{ marginTop: 20 }}>
        <Label>Your deposit is worth</Label>
        <Big size={46} style={{ marginTop: 2 }}>{v ? usd(v.myValue) : "…"}</Big>
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
