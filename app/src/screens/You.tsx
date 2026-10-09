import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import type { LocalAccount } from "viem";
import type { Holding } from "../data";
import { redeemProtection } from "../tx";
import { AddMoney } from "./AddMoney";
import { Big, Body, Button, C, F, Hairline, Label, Row, Trail, price, untilText, usd } from "../ui";

export function You({ account, ausd, mon, held, onDone, onSignOut }: { account: LocalAccount; ausd: number; mon: number; held: Holding[]; onDone: () => void; onSignOut: () => void }) {
  const [copied, setCopied] = useState(false);
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState<number>();
  const [err, setErr] = useState<string>();
  const now = Date.now() / 1000;

  async function collect(h: Holding) {
    setBusy(h.series.id);
    setErr(undefined);
    setSteps([]);
    try {
      await redeemProtection(account, h.series.id, h.units, (label, hash) =>
        setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }])),
      );
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <View>
      <Label>Your account · passkey, no seed phrase</Label>
      <Big size={48} style={{ marginTop: 6 }}>{usd(ausd)}</Big>
      <Body muted>AUSD · {mon.toFixed(4)} MON for fees</Body>

      <Hairline />
      <AddMoney account={account} mon={mon} onDone={onDone} />

      <Hairline />
      <Label>Your protection</Label>
      {held.length === 0 ? (
        <Body muted style={{ marginTop: 8 }}>Nothing yet. Pick a floor on the Protect tab.</Body>
      ) : (
        held.map((h) => {
          const s = h.series;
          const state = s.settled ? (h.payout > 0 ? "Paid out" : "Ended above the floor") : s.expiry <= now ? "Settling" : `Active · ${untilText(s.expiry - now)} left`;
          return (
            <View key={s.id} style={{ marginTop: 14 }}>
              <Text style={{ fontFamily: F.displayMed, fontSize: 20, color: C.bone }}>
                {h.units.toLocaleString()} MON above {price(s.strike)}
              </Text>
              <Row k="Status" v={state} vColor={s.settled && h.payout > 0 ? C.floor : undefined} />
              <Row k="Ends" v={new Date(s.expiry * 1000).toLocaleString()} />
              {s.settled && <Row k="MON at the end" v={price(s.settlePrice)} />}
              {s.settled && <Row k="Payout" v={usd(h.payout, 4)} vColor={h.payout > 0 ? C.floor : undefined} />}
              {s.settled && <Button title={h.payout > 0 ? `Collect ${usd(h.payout, 4)}` : "Clear it"} ghost={h.payout === 0} onPress={() => collect(h)} busy={busy === s.id} />}
              <Pressable onPress={() => Linking.openURL(`https://monadscan.com/token/${s.token}`)}>
                <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.mute, marginTop: 6 }}>PROTECTION TOKEN {s.token.slice(0, 10)}… ↗</Text>
              </Pressable>
            </View>
          );
        })
      )}
      <Trail steps={steps} />
      {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}

      <Hairline />
      <Button title="Sign out" ghost onPress={onSignOut} />
    </View>
  );
}
