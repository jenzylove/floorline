import { useEffect, useMemo, useState } from "react";
import { Text, TextInput, View, useWindowDimensions } from "react-native";
import type { LocalAccount } from "viem";
import { candles, quote, type Candle, type Market, type SeriesView } from "../data";
import { buyProtection } from "../tx";
import { Big, Body, Button, C, Card, Chips, F, FloorChart, Label, Row, Segment, Steps, Title, Trail, price, untilText, usd } from "../ui";

type Tenor = "day" | "week";
const DAY = 86400;

/** Protect in three steps: how much MON, where your floor sits (drag it on the chart), review and buy. */
export function Protect({ account, series, mkt, monHeld, ausd, demoBuyer, onDone }: { account: LocalAccount; series: SeriesView[]; mkt?: Market; monHeld: number; ausd: number; demoBuyer: boolean; onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const [unitsText, setUnitsText] = useState(monHeld >= 1 ? String(Math.floor(monHeld)) : "1000");
  const units = Math.max(0, Math.floor(Number(unitsText) || 0));
  const [tenor, setTenor] = useState<Tenor>("day");
  const [chart, setChart] = useState<Candle[]>([]);
  const [strike, setStrike] = useState<number>();
  const [q, setQ] = useState<{ premium: number } | { error: string }>();
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState(false);
  const now = Date.now() / 1000;
  const spot = mkt?.spot ?? 0;

  useEffect(() => {
    candles(24).then(setChart).catch(() => setChart([]));
  }, []);

  // floors on sale for the chosen length: a day (under 2 days left) or a week
  const open = useMemo(
    () =>
      series
        .filter((s) => !s.settled && s.expiry - now > 90 && (!s.shortTenor || demoBuyer))
        .filter((s) => (tenor === "day" ? s.expiry - now <= 2 * DAY : s.expiry - now > 2 * DAY))
        .sort((a, b) => b.strike - a.strike),
    [series, tenor, demoBuyer, Math.floor(now / 30)],
  );
  const chosen = open.find((s) => s.strike === strike) ?? open[0];
  useEffect(() => {
    if (open.length && !open.find((s) => s.strike === strike)) setStrike(open[0].strike);
  }, [open.map((s) => s.id).join(",")]);

  useEffect(() => {
    if (!chosen || !units || step < 1) return;
    let live = true;
    const run = () => quote(chosen.id, units).then((r) => live && setQ(r));
    setQ(undefined);
    run();
    const t = setInterval(run, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [chosen?.id, units, step]);

  const premium = q && "premium" in q ? q.premium : undefined;
  const below = chosen && spot ? 1 - chosen.strike / spot : 0;
  const maxPayout = chosen ? units * chosen.strike : 0;
  const worst = chosen && premium !== undefined ? Math.max(0, units * (spot - chosen.strike)) + premium : undefined;

  async function buy() {
    if (!chosen || premium === undefined) return;
    setBusy(true);
    setErr(undefined);
    setSteps([]);
    try {
      await buyProtection(account, chosen.id, units, premium, (label, hash) =>
        setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }])),
      );
      setDone(true);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done && chosen) {
    return (
      <View>
        <Title accent="protected.">{units.toLocaleString()} MON</Title>
        <Card tint="lime" style={{ marginTop: 18 }}>
          <Row k="Floor" v={price(chosen.strike)} strong />
          <Row k="Until" v={new Date(chosen.expiry * 1000).toLocaleString()} />
          <Row k="If MON ends below it, you get" v="the difference, in AUSD" />
          <Row k="You paid" v={premium !== undefined ? usd(premium, 4) : "…"} />
        </Card>
        <Trail steps={steps} />
        <Button title="Done" onPress={() => { setDone(false); setStep(0); setSteps([]); }} />
      </View>
    );
  }

  return (
    <View>
      <Steps at={step} total={3} />

      {step === 0 && (
        <View>
          <Title accent="protect?">How much MON do you want to</Title>
          <Body muted style={{ marginTop: 10 }}>You keep your MON. The floor pays you the difference if MON ends below it.</Body>
          <TextInput
            value={unitsText}
            onChangeText={(t) => setUnitsText(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            style={{ fontFamily: F.display, fontSize: 56, color: C.ink, marginTop: 22, letterSpacing: -1.5 }}
          />
          <Text style={{ fontFamily: F.medium, fontSize: 15, color: C.mute }}>MON{spot ? ` · worth about ${usd(units * spot)} today` : ""}</Text>
          <Chips
            items={[...(monHeld >= 1 ? [Math.floor(monHeld)] : []), 1000, 10000, 50000].filter((v, i, a) => a.indexOf(v) === i)}
            value={units}
            onChange={(v) => setUnitsText(String(v))}
            render={(v) => (v === Math.floor(monHeld) && monHeld >= 1 ? `All mine · ${v.toLocaleString()}` : v.toLocaleString())}
          />
          <Button title="Next: pick your floor" onPress={() => setStep(1)} disabled={units < 1} />
        </View>
      )}

      {step === 1 && (
        <View>
          <Title accent="floor.">Drag to set your</Title>
          <Segment items={["day", "week"] as Tenor[]} value={tenor} onChange={setTenor} render={(t) => (t === "day" ? "For a day" : "For a week")} />
          <View style={{ marginTop: 14, marginHorizontal: -20 }}>
            <FloorChart data={chart} floors={open.map((s) => s.strike)} floor={chosen?.strike} onPick={setStrike} width={width} height={230} />
          </View>
          <Text style={{ fontFamily: F.body, fontSize: 13, color: C.mute, marginTop: 6, textAlign: "center" }}>MON over the last day · drag up or down</Text>
          {open.length === 0 ? (
            <Body muted style={{ marginTop: 16 }}>No floors on sale for this length right now. New ones open every few minutes.</Body>
          ) : chosen ? (
            <Card style={{ marginTop: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                <View>
                  <Label>Your floor</Label>
                  <Big size={34}>{price(chosen.strike)}</Big>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Label>You pay once</Label>
                  <Big size={34} color={C.limeInk}>{premium !== undefined ? usd(premium, premium < 1 ? 3 : 2) : "…"}</Big>
                </View>
              </View>
              <Text style={{ fontFamily: F.body, fontSize: 14, color: C.ink2, marginTop: 8 }}>
                {Math.abs(below) < 0.005 ? "At today's price" : below > 0 ? `${Math.round(below * 100)}% below today's price` : `${Math.round(-below * 100)}% above today's price`} · ends in {untilText(chosen.expiry - now)}
              </Text>
              {q && "error" in q && <Body style={{ color: C.below, marginTop: 6, fontSize: 14 }}>{q.error}</Body>}
            </Card>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Button title="Back" ghost onPress={() => setStep(0)} /></View>
            <View style={{ flex: 2 }}><Button title="Review" onPress={() => setStep(2)} disabled={!chosen || premium === undefined} /></View>
          </View>
        </View>
      )}

      {step === 2 && chosen && (
        <View>
          <Title accent="looks right.">Check this</Title>
          <Card style={{ marginTop: 18 }}>
            <Row k="You protect" v={`${units.toLocaleString()} MON`} strong />
            <Row k="Floor" v={price(chosen.strike)} />
            <Row k="Ends" v={new Date(chosen.expiry * 1000).toLocaleString()} />
            <Row k="You pay once" v={premium !== undefined ? usd(premium, 4) : "…"} vColor={C.limeInk} strong />
            <Row k="If MON ends below the floor" v={`you get up to ${usd(maxPayout)}`} />
            {worst !== undefined && <Row k="Most you can lose on this MON" v={usd(worst)} />}
          </Card>
          <Body muted style={{ marginTop: 12, fontSize: 14 }}>
            The full {usd(maxPayout)} is locked in the vault for you the moment you buy. You can resell the floor before the date.
          </Body>
          {premium !== undefined && premium > ausd && (
            <Body style={{ color: C.below, marginTop: 10, fontSize: 14 }}>You need {usd(premium - ausd, 4)} more AUSD. Add money in Wallet.</Body>
          )}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Button title="Back" ghost onPress={() => setStep(1)} /></View>
            <View style={{ flex: 2 }}><Button title={`Pay ${premium !== undefined ? usd(premium, 3) : ""}`} onPress={buy} disabled={premium === undefined || premium > ausd} busy={busy} /></View>
          </View>
          <Trail steps={steps} />
          {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}
        </View>
      )}
    </View>
  );
}
