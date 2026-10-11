import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import type { LocalAccount } from "viem";
import { perplAccount, perplMinOpen, type Market, type PerplAccount } from "../data";
import { perplMove, perplOpenAccount, perplOrder } from "../tx";
import { Big, Body, Button, C, Card, Chips, F, Label, Row, Segment, Title, Trail, price, usd } from "../ui";

const SIZES = [100, 500, 1_000, 2_000];
const LEVERAGE = [1, 2, 5];

/** MON perpetual on Perpl, traded straight from the user's own passkey account. Orders are on-chain IOC. */
export function Trade({ account, mkt, ausd, onDone }: { account: LocalAccount; mkt?: Market; ausd: number; onDone: () => void }) {
  const [acct, setAcct] = useState<PerplAccount | null>();
  const [minOpen, setMinOpen] = useState<number>();
  const [fund, setFund] = useState("");
  const [size, setSize] = useState(SIZES[0]);
  const [lev, setLev] = useState(LEVERAGE[0]);
  const [dir, setDir] = useState<"in" | "out">("out");
  const [move, setMove] = useState("");
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const load = () => {
    perplAccount(account.address).then((a) => setAcct(a ?? null)).catch(() => setAcct(null));
    perplMinOpen().then(setMinOpen).catch(() => undefined);
  };
  useEffect(load, [account.address]);

  async function run(fn: (step: (label: string, hash?: string) => void) => Promise<unknown>) {
    setBusy(true);
    setErr(undefined);
    setSteps([]);
    try {
      await fn((label, hash) => setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }])));
      load();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  }

  const mark = mkt?.mark ?? 0;
  const pos = acct?.position;
  const margin = (size * mark) / lev;

  return (
    <View>
      <Title accent="or short.">Trade MON, long</Title>
      <Body muted style={{ marginTop: 10 }}>On Perpl's on-chain order book, from your own account. Every order is signed with your fingerprint.</Body>
      <Card style={{ marginTop: 18 }}>
      <Label>MON perpetual on Perpl</Label>
      <Big size={44}>{mark ? price(mark) : "…"}</Big>
      <View style={{ height: 14 }} />
      {acct === undefined ? (
        <Body muted>Reading your Perpl account…</Body>
      ) : acct === null ? (
        <View>
          <Label>Open your Perpl account</Label>
          <Body muted style={{ marginTop: 6 }}>
            Perpl needs at least {minOpen !== undefined ? usd(minOpen) : "…"} AUSD to open an account. It stays yours and you can withdraw it.
          </Body>
          <TextInput
            value={fund}
            onChangeText={setFund}
            placeholder={minOpen ? String(minOpen) : "10"}
            placeholderTextColor={C.mute}
            keyboardType="decimal-pad"
            style={{ fontFamily: F.display, fontSize: 36, color: C.ink, marginTop: 12, borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 6 }}
          />
          <Row k="In your wallet" v={`${usd(ausd)} AUSD`} />
          <Button
            title="Open Perpl account"
            onPress={() => run((step) => perplOpenAccount(account, Number(fund), step))}
            disabled={!(Number(fund) >= (minOpen ?? Infinity) && Number(fund) <= ausd)}
            busy={busy}
          />
        </View>
      ) : (
        <View>
          <Row k="Perpl account" v={`#${acct.id}`} />
          <Row k="Free balance" v={usd(acct.balance)} />
          {pos ? (
            <View style={{ marginTop: 10 }}>
              <Label>Open position</Label>
              <Big size={30} color={pos.pnl >= 0 ? C.limeInk : C.below}>
                {pos.side === "long" ? "Long" : "Short"} {pos.lots.toLocaleString()} MON
              </Big>
              <Row k="Entry" v={price(pos.entry)} />
              <Row k="Margin" v={usd(pos.deposit)} />
              <Row k="Profit or loss" v={usd(pos.pnl, 4)} vColor={pos.pnl >= 0 ? C.limeInk : C.below} />
              <Button
                title={`Close ${pos.side}`}
                ghost
                onPress={() => run((step) => perplOrder(account, pos.side === "long" ? "closeLong" : "closeShort", pos.lots, mark, 1, step))}
                busy={busy}
              />
            </View>
          ) : (
            <View>
              <Label style={{ marginTop: 10 }}>Size</Label>
              <Chips items={SIZES} value={size} onChange={setSize} render={(v) => `${v.toLocaleString()} MON`} />
              <Label style={{ marginTop: 16 }}>Leverage</Label>
              <Chips items={LEVERAGE} value={lev} onChange={setLev} render={(v) => `${v}x`} />
              <Row k="Margin needed" v={usd(margin, 4)} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Long" onPress={() => run((step) => perplOrder(account, "openLong", size, mark, lev, step))} disabled={!mark || margin > acct.balance} busy={busy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Short" ghost onPress={() => run((step) => perplOrder(account, "openShort", size, mark, lev, step))} disabled={!mark || margin > acct.balance} busy={busy} />
                </View>
              </View>
            </View>
          )}
        </View>
      )}
      </Card>
      {acct && (
        <Card style={{ marginTop: 14 }}>
          <Label>Money in your Perpl account</Label>
          <Segment items={["out", "in"] as ("in" | "out")[]} value={dir} onChange={(d) => { setDir(d); setMove(""); }} render={(d) => (d === "out" ? "Withdraw" : "Add more")} />
          <TextInput
            value={move}
            onChangeText={setMove}
            placeholder="0.00"
            placeholderTextColor={C.mute}
            keyboardType="decimal-pad"
            style={{ fontFamily: F.display, fontSize: 36, color: C.ink, marginTop: 12 }}
          />
          <Body muted style={{ fontSize: 14 }}>
            {dir === "out" ? `${usd(acct.balance)} free to withdraw. It goes back to your wallet here.` : `${usd(ausd)} AUSD in your wallet.`}
          </Body>
          <Button
            title={dir === "out" ? "Withdraw from Perpl" : "Add to Perpl"}
            ghost
            onPress={() => run((step) => perplMove(account, dir, Number(move), step)).then(() => setMove(""))}
            disabled={!(Number(move) > 0 && Number(move) <= (dir === "out" ? acct.balance : ausd) + 1e-9)}
            busy={busy}
          />
          {dir === "out" && pos && <Body muted style={{ fontSize: 13, marginTop: 6 }}>Close your position first to free its margin.</Body>}
        </Card>
      )}
      <Trail steps={steps} />
      {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}
    </View>
  );
}
