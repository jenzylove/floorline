import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { isAddress, type Address, type LocalAccount } from "viem";
import { sendOut } from "../tx";
import { Body, Button, C, F, Label, Segment, Trail, usd } from "../ui";

type Token = "AUSD" | "MON";
const FEE_RESERVE = 0.05; // MON kept back so the send itself can be paid for

/** Send AUSD or MON from the passkey account to any Monad address. The way out of the app. */
export function Send({ account, ausd, mon, onDone }: { account: LocalAccount; ausd: number; mon: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<Token>("AUSD");
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const max = token === "AUSD" ? ausd : Math.max(0, mon - FEE_RESERVE);
  const n = Number(amt) || 0;
  const validTo = isAddress(to.trim());

  async function run() {
    setBusy(true);
    setErr(undefined);
    setSteps([]);
    try {
      await sendOut(account, token, to.trim() as Address, n, (label, hash) =>
        setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }])),
      );
      setAmt("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)}>
        <Text style={{ fontFamily: F.semi, fontSize: 17, color: C.ink }}>Withdraw to another wallet →</Text>
        <Body muted style={{ marginTop: 4, fontSize: 14 }}>Send your AUSD or MON to any Monad address.</Body>
      </Pressable>
    );
  }
  return (
    <View>
      <Text style={{ fontFamily: F.semi, fontSize: 17, color: C.ink }}>Withdraw to another wallet</Text>
      <Segment items={["AUSD", "MON"] as Token[]} value={token} onChange={(t) => { setToken(t); setAmt(""); }} render={(t) => t} />
      <Label style={{ marginTop: 14 }}>To this Monad address</Label>
      <TextInput
        value={to}
        onChangeText={setTo}
        placeholder="0x…"
        placeholderTextColor={C.mute}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ fontFamily: F.medium, fontSize: 15, color: C.ink, borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 8 }}
      />
      {to.length > 0 && !validTo && <Body style={{ color: C.below, fontSize: 13, marginTop: 4 }}>That is not a full address yet.</Body>}
      <TextInput
        value={amt}
        onChangeText={setAmt}
        placeholder="0.00"
        placeholderTextColor={C.mute}
        keyboardType="decimal-pad"
        style={{ fontFamily: F.display, fontSize: 36, color: C.ink, marginTop: 10 }}
      />
      <Pressable onPress={() => setAmt(String(Math.floor(max * 10_000) / 10_000))}>
        <Text style={{ fontFamily: F.medium, fontSize: 14, color: C.mute }}>
          {token === "AUSD" ? `${usd(ausd)} AUSD` : `${mon.toFixed(4)} MON`} in your account · <Text style={{ color: C.ink, textDecorationLine: "underline" }}>use all</Text>
        </Text>
      </Pressable>
      <Button title={`Send ${token}`} onPress={run} disabled={!(validTo && n > 0 && n <= max + 1e-9)} busy={busy} />
      <Trail steps={steps} />
      {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}
      <Body muted style={{ fontSize: 13, marginTop: 8 }}>Sends on Monad only. Check the address: a send cannot be undone.</Body>
    </View>
  );
}
