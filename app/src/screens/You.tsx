import { friendly } from "../errors";
import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import type { LocalAccount } from "viem";
import type { Holding } from "../data";
import { redeemProtection } from "../tx";
import { AddMoney } from "./AddMoney";
import { Send } from "./Send";
import { Big, Body, Button, C, Card, F, Label, Row, Segment, Title, Trail, price, untilText, usd } from "../ui";
import type { ThemePref } from "../theme";

/** Wallet: balances, add money, the floors you hold and payouts to collect. */
export function You({ account, ausd, mon, held, pref, onPref, onDone, onSignOut }: { account: LocalAccount; ausd: number; mon: number; held: Holding[]; pref: ThemePref; onPref: (p: ThemePref) => void; onDone: () => void; onSignOut: () => void }) {
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
      setErr(friendly(e));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <View>
      <Title>Wallet</Title>
      <Card style={{ marginTop: 16 }}>
        <Label>In your account</Label>
        <Big size={44}>{usd(ausd)}</Big>
        <Text style={{ fontFamily: F.body, fontSize: 14, color: C.mute, marginTop: 4 }}>AUSD · {mon.toFixed(4)} MON for fees · passkey account, no seed phrase</Text>
      </Card>

      <Card style={{ marginTop: 14 }}>
        <AddMoney account={account} mon={mon} onDone={onDone} />
      </Card>

      <Card style={{ marginTop: 14 }}>
        <Send account={account} ausd={ausd} mon={mon} onDone={onDone} />
      </Card>

      <Label style={{ marginTop: 22 }}>Your floors</Label>
      {held.length === 0 ? (
        <Body muted style={{ marginTop: 8 }}>None yet. Protect some MON from Home.</Body>
      ) : (
        held.map((h) => {
          const s = h.series;
          const state = s.settled ? (h.payout > 0 ? "Paid out" : "Ended above your floor") : s.expiry <= now ? "Settling" : `${untilText(s.expiry - now)} left`;
          return (
            <Card key={s.id} style={{ marginTop: 10 }} tint={s.settled && h.payout > 0 ? "lime" : undefined}>
              <Text style={{ fontFamily: F.semi, fontSize: 18, color: C.ink }}>
                {h.units.toLocaleString()} MON above {price(s.strike)}
              </Text>
              <Row k="Status" v={state} vColor={s.settled && h.payout > 0 ? C.limeInk : undefined} />
              <Row k="Ends" v={new Date(s.expiry * 1000).toLocaleString()} />
              {s.settled && <Row k="MON at the end" v={price(s.settlePrice)} />}
              {s.settled && <Row k="Payout" v={usd(h.payout, 4)} strong />}
              {s.settled && <Button title={h.payout > 0 ? `Collect ${usd(h.payout, 4)}` : "Clear it"} ghost={h.payout === 0} onPress={() => collect(h)} busy={busy === s.id} />}
              <Pressable onPress={() => Linking.openURL(`https://monadscan.com/token/${s.token}`)}>
                <Text style={{ fontFamily: F.medium, fontSize: 12, color: C.mute, marginTop: 8 }}>Floor token {s.token.slice(0, 10)}… ↗</Text>
              </Pressable>
            </Card>
          );
        })
      )}
      <Trail steps={steps} />
      {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}

      <Label style={{ marginTop: 26 }}>Appearance</Label>
      <Segment items={["system", "light", "dark"] as ThemePref[]} value={pref} onChange={onPref} render={(p) => (p === "system" ? "Match phone" : p === "light" ? "Light" : "Dark")} />

      <Button title="Sign out" ghost onPress={onSignOut} />
    </View>
  );
}
