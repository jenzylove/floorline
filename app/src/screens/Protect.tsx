import { useEffect, useMemo, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import type { LocalAccount } from "viem";
import { candles, quote, type Candle, type Market, type SeriesView } from "../data";
import { buyProtection } from "../tx";
import { Big, Body, Button, C, Chips, FloorChart, Hairline, Label, Row, Trail, price, untilText, usd } from "../ui";

const AMOUNTS = [100, 500, 1_000, 5_000];

function floorLabel(s: SeriesView, spot: number) {
  const below = 1 - s.strike / spot;
  const where = Math.abs(below) < 0.01 ? "today's price" : below > 0 ? `${Math.round(below * 100)}% below` : `${Math.round(-below * 100)}% above`;
  return `${where} · ${untilText(s.expiry - Date.now() / 1000)}`;
}

export function Protect({ account, series, mkt, monHeld, demoBuyer, onDone }: { account: LocalAccount; series: SeriesView[]; mkt?: Market; monHeld: number; demoBuyer: boolean; onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [chart, setChart] = useState<Candle[]>([]);
  const now = Date.now() / 1000;
  const open = useMemo(
    () => series.filter((s) => !s.settled && s.expiry - now > 90 && (!s.shortTenor || demoBuyer)).sort((a, b) => a.expiry - b.expiry || b.strike - a.strike),
    [series, demoBuyer, Math.floor(now / 30)],
  );
  const [pick, setPick] = useState<number>();
  const chosen = open.find((s) => s.id === pick) ?? open[0];
  const amounts = useMemo(() => (monHeld >= 1 ? [Math.floor(monHeld), ...AMOUNTS.filter((a) => a !== Math.floor(monHeld))] : AMOUNTS), [monHeld]);
  const [units, setUnits] = useState(AMOUNTS[1]);
  const [q, setQ] = useState<{ premium: number } | { error: string }>();
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    candles(24).then(setChart).catch(() => setChart([]));
  }, []);

  useEffect(() => {
    if (!chosen) return;
    let live = true;
    const run = () => quote(chosen.id, units).then((r) => live && setQ(r));
    setQ(undefined);
    run();
    const t = setInterval(run, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [chosen?.id, units]);

  const spot = mkt?.spot ?? 0;
  const premium = q && "premium" in q ? q.premium : undefined;
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
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Label>MON on Perpl, live</Label>
      <Big size={52}>{spot ? price(spot) : "…"}</Big>
      <View style={{ marginTop: 14, marginHorizontal: -24 }}>
        <FloorChart data={chart} floor={chosen?.strike} width={width} />
      </View>
      <Body muted style={{ marginTop: 10 }}>
        Pick a floor. If MON is below it when the time is up, you get the difference in AUSD for every MON you protected. You keep your MON and all the upside.
      </Body>

      <Hairline />
      <Label>Your floor</Label>
      {open.length === 0 ? (
        <Body muted style={{ marginTop: 8 }}>No protection is on sale right now. New floors open every few minutes.</Body>
      ) : (
        <Chips items={open.map((s) => s.id)} value={chosen?.id ?? -1} onChange={setPick} render={(id) => floorLabel(open.find((s) => s.id === id)!, spot)} />
      )}

      <Label style={{ marginTop: 22 }}>How much MON</Label>
      <Chips items={amounts} value={units} onChange={setUnits} render={(a) => (a === Math.floor(monHeld) && monHeld >= 1 ? `all mine · ${a.toLocaleString()}` : a.toLocaleString())} />

      {chosen && (
        <View style={{ marginTop: 22 }}>
          <Label>You pay once</Label>
          <Big size={40} color={C.floor}>{premium !== undefined ? usd(premium, premium < 1 ? 4 : 2) : q && "error" in q ? "—" : "…"}</Big>
          {q && "error" in q && <Body style={{ color: C.below, marginTop: 6 }}>{q.error}</Body>}
          <View style={{ marginTop: 10 }}>
            <Row k="Floor" v={price(chosen.strike)} />
            <Row k="Ends" v={new Date(chosen.expiry * 1000).toLocaleString()} />
            <Row k="Pays up to" v={usd(maxPayout)} />
            {worst !== undefined && <Row k="Most you can lose on this MON" v={usd(worst)} />}
            <Row k="Locked in the vault for you" v={usd(maxPayout)} />
          </View>
          <Button title={`Protect ${units.toLocaleString()} MON`} onPress={buy} disabled={premium === undefined} busy={busy} />
          <Trail steps={steps} />
          {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}
          <Body muted style={{ marginTop: 14, fontSize: 13 }}>
            Don't hold MON? The same protection pays when MON falls, so it works as a bet down where the most you can lose is what you pay.
          </Body>
        </View>
      )}
    </View>
  );
}
