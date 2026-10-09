import { useState } from "react";
import { TextInput, View } from "react-native";
import type { LocalAccount } from "viem";
import type { VaultView } from "../data";
import { depositEarn, withdrawEarn } from "../tx";
import { Big, Body, Button, C, F, Hairline, Label, Row, Trail, usd } from "../ui";

export function Earn({ account, v, ausd, onDone }: { account: LocalAccount; v?: VaultView; ausd: number; onDone: () => void }) {
  const [amt, setAmt] = useState("");
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const n = Number(amt);

  async function run(kind: "deposit" | "withdraw") {
    setBusy(true);
    setErr(undefined);
    setSteps([]);
    const step = (label: string, hash?: string) => setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }]));
    try {
      if (kind === "deposit") await depositEarn(account, n, step);
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
      <Label>Earn by backing protection</Label>
      <Big size={34} style={{ marginTop: 6 }}>Put in AUSD. Every floor someone buys pays you.</Big>
      <Body muted style={{ marginTop: 12 }}>
        Your AUSD backs the protection the vault sells and earns the premiums. Every floor sold is fully backed: the money it could pay out is locked the moment it is bought. The vault also hedges on Perpl. When MON falls hard, payouts come out of the vault, so you can lose part of what you put in.
      </Body>

      <Hairline />
      <Label>Your deposit</Label>
      <Big size={48} color={C.floor}>{v ? usd(v.myValue) : "…"}</Big>
      <Row k="In your wallet" v={`${usd(ausd)} AUSD`} />
      <Row k="You can take out now" v={v ? usd(v.myMaxWithdraw) : "…"} />

      <TextInput
        value={amt}
        onChangeText={setAmt}
        placeholder="0.00"
        placeholderTextColor={C.mute}
        keyboardType="decimal-pad"
        style={{ fontFamily: F.display, fontSize: 40, color: C.bone, marginTop: 16, borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 6 }}
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button title="Deposit" onPress={() => run("deposit")} disabled={!(n > 0 && n <= ausd)} busy={busy} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Withdraw" ghost onPress={() => run("withdraw")} disabled={!(n > 0 && v && n <= v.myMaxWithdraw)} busy={busy} />
        </View>
      </View>
      <Trail steps={steps} />
      {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}

      <Hairline />
      <Label>The vault, live</Label>
      {v && (
        <View style={{ marginTop: 8 }}>
          <Row k="Owned by depositors" v={usd(v.totalAssets)} />
          <Row k="Locked behind protection" v={usd(v.locked)} />
          <Row k="Value of open protection" v={usd(v.liability)} />
          <Row k="Owed to holders, not yet collected" v={usd(v.owed)} />
          <Row k="Free to back new protection" v={usd(v.free)} />
          <Row k="Selling" v={v.paused ? "paused" : "open"} vColor={v.paused ? C.below : C.floor} />
        </View>
      )}
    </View>
  );
}
