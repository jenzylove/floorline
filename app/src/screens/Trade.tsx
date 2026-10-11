import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { LocalAccount } from "viem";
import { candles, perplAccount, perplMinOpen, type Candle, type Market, type PerplAccount } from "../data";
import { friendly } from "../errors";
import { perplMove, perplOpenAccount, perplOrder } from "../tx";
import { Big, Body, Button, C, Card, Chips, F, FloorChart, Label, Row, Segment, Title, Trail, price, usd } from "../ui";

const SIZES = [100, 500, 1_000, 2_000];
const LEVERAGE = [1, 2, 5];
type Side = "up" | "down";

/**
 * Trade MON on Perpl from the user's own passkey account. Written for someone who has never traded:
 * one question (up or down?), what it would make or lose in dollars, and one button.
 */
export function Trade({ account, mkt, ausd, onDone }: { account: LocalAccount; mkt?: Market; ausd: number; onDone: () => void }) {
  const { width } = useWindowDimensions();
  const [acct, setAcct] = useState<PerplAccount | null>();
  const [minOpen, setMinOpen] = useState<number>();
  const [chart, setChart] = useState<Candle[]>([]);
  const [fund, setFund] = useState("");
  const [side, setSide] = useState<Side>("up");
  const [size, setSize] = useState(SIZES[0]);
  const [lev, setLev] = useState(LEVERAGE[0]);
  const [more, setMore] = useState(false);
  const [help, setHelp] = useState(false);
  const [dir, setDir] = useState<"in" | "out">("out");
  const [move, setMove] = useState("");
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [note, setNote] = useState<string>();

  const load = () => {
    perplAccount(account.address).then((a) => setAcct(a ?? null)).catch(() => setAcct(null));
    perplMinOpen().then(setMinOpen).catch(() => undefined);
  };
  useEffect(load, [account.address]);
  useEffect(() => {
    candles(24).then(setChart).catch(() => setChart([]));
  }, []);

  async function run(done: string, fn: (step: (label: string, hash?: string) => void) => Promise<unknown>) {
    setBusy(true);
    setErr(undefined);
    setNote(undefined);
    setSteps([]);
    try {
      await fn((label, hash) => setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }])));
      setNote(done);
      load();
      onDone();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  const mark = mkt?.mark ?? 0;
  const pos = acct?.position;
  const worth = size * mark; // dollars of MON this trade follows
  const margin = worth / lev;
  const swing = worth * 0.1; // what a 10% move in MON is worth on this trade
  const dayAgo = chart.length ? chart[0].c : 0;
  const dayMove = dayAgo && mark ? mark / dayAgo - 1 : 0;

  return (
    <View>
      <Title accent="up or down.">Trade MON,</Title>
      <Body muted style={{ marginTop: 10 }}>Think MON will rise? Go long. Think it will fall? Go short. You don't need to own any MON.</Body>

      <View style={{ marginTop: 18 }}>
        <Label>MON right now</Label>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
          <Big size={44}>{mark ? price(mark) : "…"}</Big>
          {dayAgo > 0 && (
            <Text style={{ fontFamily: F.semi, fontSize: 16, color: dayMove >= 0 ? C.limeInk : C.below, marginBottom: 8 }}>
              {dayMove >= 0 ? "up" : "down"} {Math.abs(dayMove * 100).toFixed(1)}% today
            </Text>
          )}
        </View>
      </View>
      {chart.length > 1 && (
        <View style={{ marginTop: 6, marginHorizontal: -20 }}>
          <FloorChart data={chart} width={width} height={170} />
        </View>
      )}

      {acct === undefined ? (
        <Body muted style={{ marginTop: 16 }}>Reading your trading account…</Body>
      ) : acct === null ? (
        <Card style={{ marginTop: 16 }}>
          <Text style={{ fontFamily: F.semi, fontSize: 18, color: C.ink }}>First, open your trading account</Text>
          <Body muted style={{ marginTop: 6 }}>
            Trades happen on Perpl, an exchange on Monad. Move at least {minOpen !== undefined ? usd(minOpen) : "…"} of your AUSD there to start. It stays yours and you can withdraw it any time.
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
          {ausd < (minOpen ?? 10) && <Body style={{ color: C.below, fontSize: 14, marginTop: 6 }}>Add money in Wallet first.</Body>}
          <Button
            title="Open my trading account"
            onPress={() => run("Your trading account is open. Now pick up or down.", (step) => perplOpenAccount(account, Number(fund), step))}
            disabled={!(Number(fund) >= (minOpen ?? Infinity) && Number(fund) <= ausd)}
            busy={busy}
          />
        </Card>
      ) : pos ? (
        <Card style={{ marginTop: 16 }} tint={pos.pnl >= 0 ? "lime" : undefined}>
          <Label>Your trade</Label>
          <Big size={30}>
            {pos.side === "long" ? "Long" : "Short"} {pos.lots.toLocaleString()} MON
          </Big>
          <Body style={{ marginTop: 6 }}>
            {pos.side === "long" ? "You make money while MON rises and lose while it falls." : "You make money while MON falls and lose while it rises."}
          </Body>
          <View style={{ marginTop: 12 }}>
            <Label>Right now you are</Label>
            <Big size={40} color={pos.pnl >= 0 ? C.limeInk : C.below}>
              {pos.pnl >= 0 ? "up" : "down"} {usd(Math.abs(pos.pnl), 4)}
            </Big>
          </View>
          <Row k="You got in at" v={price(pos.entry)} />
          <Row k="MON now" v={price(mark)} />
          <Row k="Set aside for this trade" v={usd(pos.deposit)} />
          <Button
            title="Close the trade"
            onPress={() =>
              run("Trade closed. The result is in your trading balance below.", (step) => perplOrder(account, pos.side === "long" ? "closeLong" : "closeShort", pos.lots, mark, 1, step))
            }
            busy={busy}
          />
          <Body muted style={{ fontSize: 13, marginTop: 8 }}>Closing ends the trade at the current price. What you set aside comes back, plus what you made or minus what you lost.</Body>
        </Card>
      ) : (
        <Card style={{ marginTop: 16 }}>
          <Label>I think MON will</Label>
          <Segment items={["up", "down"] as Side[]} value={side} onChange={setSide} render={(d) => (d === "up" ? "Go up" : "Go down")} />
          <Label style={{ marginTop: 16 }}>How much MON</Label>
          <Chips items={SIZES} value={size} onChange={setSize} render={(v) => `${v.toLocaleString()} MON`} />

          <View style={{ marginTop: 14 }}>
            <Label>What that means</Label>
            <Row k={`If MON ${side === "up" ? "rises" : "falls"} 10%`} v={`you make about ${usd(swing)}`} vColor={C.limeInk} strong />
            <Row k={`If MON ${side === "up" ? "falls" : "rises"} 10%`} v={`you lose about ${usd(swing)}`} vColor={C.below} />
            <Row k="Set aside from your trading balance" v={usd(margin)} />
          </View>

          <Button
            title={side === "up" ? `Go long ${size.toLocaleString()} MON` : `Go short ${size.toLocaleString()} MON`}
            onPress={() =>
              run(`You are ${side === "up" ? "long" : "short"} ${size.toLocaleString()} MON. Watch it here and close whenever you like.`, (step) =>
                perplOrder(account, side === "up" ? "openLong" : "openShort", size, mark, lev, step),
              )
            }
            disabled={!mark || margin > acct.balance}
            busy={busy}
          />
          {margin > acct.balance && <Body style={{ color: C.below, fontSize: 14, marginTop: 8 }}>That needs {usd(margin)} and your trading balance is {usd(acct.balance)}. Pick a smaller size or add more below.</Body>}

          <Pressable onPress={() => setMore(!more)} style={{ marginTop: 14 }}>
            <Text style={{ fontFamily: F.medium, fontSize: 14, color: C.mute }}>{more ? "Hide leverage" : "More control: leverage →"}</Text>
          </Pressable>
          {more && (
            <View>
              <Chips items={LEVERAGE} value={lev} onChange={setLev} render={(v) => `${v}x`} />
              <Body muted style={{ fontSize: 13, marginTop: 8 }}>
                Leverage sets aside less of your money for the same trade. The gain or loss in dollars stays the same, so a smaller move can use up what you set aside and Perpl then closes the trade for you. 1x is the calm choice.
              </Body>
            </View>
          )}
        </Card>
      )}

      {note && (
        <Card tint="lime" style={{ marginTop: 14 }}>
          <Text style={{ fontFamily: F.semi, fontSize: 16, color: C.ink }}>{note}</Text>
        </Card>
      )}
      <Trail steps={steps} />
      {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}

      {acct && (
        <Card style={{ marginTop: 14 }}>
          <Label>Your trading balance</Label>
          <Big size={34}>{usd(acct.balance)}</Big>
          <Body muted style={{ fontSize: 14, marginTop: 2 }}>Money you moved to Perpl. Take it back to your wallet any time.</Body>
          <Segment items={["out", "in"] as ("in" | "out")[]} value={dir} onChange={(d) => { setDir(d); setMove(""); }} render={(d) => (d === "out" ? "Withdraw" : "Add more")} />
          <TextInput
            value={move}
            onChangeText={setMove}
            placeholder="0.00"
            placeholderTextColor={C.mute}
            keyboardType="decimal-pad"
            style={{ fontFamily: F.display, fontSize: 36, color: C.ink, marginTop: 12 }}
          />
          <Body muted style={{ fontSize: 14 }}>{dir === "out" ? `${usd(acct.balance)} free to withdraw.` : `${usd(ausd)} AUSD in your wallet.`}</Body>
          <Button
            title={dir === "out" ? "Withdraw to my wallet" : "Add to trading balance"}
            ghost
            onPress={() =>
              run(dir === "out" ? "Done. The money is back in your wallet." : "Done. Added to your trading balance.", (step) => perplMove(account, dir, Number(move), step)).then(() => setMove(""))
            }
            disabled={!(Number(move) > 0 && Number(move) <= (dir === "out" ? acct.balance : ausd) + 1e-9)}
            busy={busy}
          />
          {dir === "out" && pos && <Body muted style={{ fontSize: 13, marginTop: 6 }}>Close your trade first to free what is set aside for it.</Body>}
        </Card>
      )}

      <Pressable onPress={() => setHelp(!help)} style={{ marginTop: 18 }}>
        <Text style={{ fontFamily: F.semi, fontSize: 16, color: C.ink }}>{help ? "Hide" : "New to trading? Read this first →"}</Text>
      </Pressable>
      {help && (
        <View style={{ marginTop: 8 }}>
          <Body muted style={{ fontSize: 14 }}>Long means you gain when MON's price goes up. Short means you gain when it goes down. Either way you can lose money if it goes the other way.</Body>
          <Body muted style={{ fontSize: 14, marginTop: 8 }}>You are not buying MON. You are making a trade that follows its price, on Perpl's order book on Monad. It stays open until you close it.</Body>
          <Body muted style={{ fontSize: 14, marginTop: 8 }}>Start small. 100 MON at 1x moves by a few cents for every 1% MON moves.</Body>
          <Body muted style={{ fontSize: 14, marginTop: 8 }}>Want cover instead of a bet? Protect sets a floor under MON you already hold, for one payment.</Body>
        </View>
      )}
    </View>
  );
}
