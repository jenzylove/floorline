import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { isAddress, type Address, type LocalAccount } from "viem";
import { convertToAusd, depositStatus, quoteDeposit, quoteToAusd, sources, statusText, usdcBalance, type Deposit, type Source } from "../aurora";
import { Big, Body, Button, C, Chips, F, Label, Row, Trail, usd } from "../ui";

type Receive = "USDC" | "MON";

/** Add money from another chain with Aurora Intents. Lands on Monad in the passkey account. */
export function AddMoney({ account, onDone }: { account: LocalAccount; onDone: () => void }) {
  const [list, setList] = useState<Source[]>([]);
  const [chain, setChain] = useState<string>();
  const [symbol, setSymbol] = useState("USDC");
  const [receive, setReceive] = useState<Receive>("USDC");
  const [amount, setAmount] = useState("5");
  const [refund, setRefund] = useState("");
  const [dep, setDep] = useState<Deposit>();
  const [status, setStatus] = useState<string>();
  const [destTx, setDestTx] = useState<string>();
  const [usdc, setUsdc] = useState(0);
  const [conv, setConv] = useState<{ ausd: number; via: string }>();
  const [steps, setSteps] = useState<{ label: string; hash?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    sources()
      .then((l) => {
        setList(l);
        setChain(l.find((x) => x.chain === "Base")?.chain ?? l[0]?.chain);
      })
      .catch((e) => setErr(String(e)));
    usdcBalance(account.address).then(setUsdc).catch(() => undefined);
  }, [account.address]);

  const chains = useMemo(() => [...new Set(list.map((s) => s.chain))], [list]);
  const src = list.find((s) => s.chain === chain && s.symbol === symbol) ?? list.find((s) => s.chain === chain);

  // follow the deposit until it lands or fails
  useEffect(() => {
    if (!dep) return;
    let live = true;
    const t = setInterval(async () => {
      try {
        const s = await depositStatus(dep.depositAddress);
        if (!live) return;
        setStatus(s.status);
        if (s.destTx) setDestTx(s.destTx);
        if (s.done || s.failed) {
          clearInterval(t);
          setUsdc(await usdcBalance(account.address));
          onDone();
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [dep?.depositAddress]);

  useEffect(() => {
    if (usdc >= 0.1) quoteToAusd(usdc).then((q) => setConv({ ausd: q.ausd, via: q.via })).catch(() => setConv(undefined));
  }, [usdc]);

  async function getAddress() {
    if (!src) return;
    setBusy(true);
    setErr(undefined);
    try {
      setDep(await quoteDeposit(src, receive, Number(amount), account.address, refund as Address));
      setStatus("PENDING_DEPOSIT");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    setBusy(true);
    setErr(undefined);
    setSteps([]);
    try {
      await convertToAusd(account, usdc, (label, hash) => setSteps((st) => (hash ? st.map((x) => (x.label === label && !x.hash ? { label, hash } : x)) : [...st, { label }])));
      setUsdc(await usdcBalance(account.address));
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Label>Add money from any chain · Aurora Intents</Label>
      <Body muted style={{ marginTop: 6 }}>
        Pay with USDC or USDT from another chain. It lands in this account on Monad in about a minute. Nothing to bridge yourself.
      </Body>

      {!dep ? (
        <View>
          <Label style={{ marginTop: 16 }}>Pay from</Label>
          {chain && <Chips items={chains} value={chain} onChange={setChain} render={(c) => c} />}
          <Chips items={["USDC", "USDT"]} value={symbol} onChange={setSymbol} render={(s) => s} />
          <Label style={{ marginTop: 16 }}>Arrives as</Label>
          <Chips items={["USDC", "MON"] as Receive[]} value={receive} onChange={setReceive} render={(r) => (r === "USDC" ? "USDC, then AUSD" : "MON for fees")} />
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholderTextColor={C.mute}
            style={{ fontFamily: F.display, fontSize: 36, color: C.bone, marginTop: 12, borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 6 }}
          />
          <Body muted style={{ fontSize: 13 }}>{receive === "MON" ? "MON to receive" : "USDC to receive"}</Body>
          <TextInput
            value={refund}
            onChangeText={setRefund}
            autoCapitalize="none"
            placeholder="Your wallet on that chain (for refunds)"
            placeholderTextColor={C.mute}
            style={{ fontFamily: F.mono, fontSize: 13, color: C.bone, marginTop: 14, borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 8 }}
          />
          <Button title="Get a deposit address" onPress={getAddress} disabled={!src || !(Number(amount) > 0) || !isAddress(refund)} busy={busy} />
        </View>
      ) : (
        <View style={{ marginTop: 14 }}>
          <Label>Send exactly</Label>
          <Big size={36} color={C.floor}>
            {dep.amountIn} {src?.symbol}
          </Big>
          <Body muted>on {src?.chain}, to this one-time address:</Body>
          <Pressable
            onPress={async () => {
              await Clipboard.setStringAsync(dep.depositAddress);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: C.bone, marginTop: 8 }}>{dep.depositAddress}</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.mute, marginTop: 4 }}>{copied ? "COPIED" : "TAP TO COPY"}</Text>
          </Pressable>
          <Row k="You receive on Monad" v={`${dep.amountOut} ${receive}`} />
          <Row k="Usually takes" v={`${dep.timeEstimate} s`} />
          <Row k="Status" v={statusText[status ?? ""] ?? status ?? "…"} vColor={status === "SUCCESS" ? C.floor : undefined} />
          {destTx && <Row k="Arrival tx" v={`${destTx.slice(0, 10)}…`} />}
          <Button title="Start another" ghost onPress={() => setDep(undefined)} />
        </View>
      )}

      {usdc >= 0.1 && (
        <View style={{ marginTop: 18 }}>
          <Label>USDC in this account</Label>
          <Big size={30}>{usd(usdc)}</Big>
          {conv && <Row k="Converts to" v={`${usd(conv.ausd, 4)} AUSD via ${conv.via}`} />}
          <Button title="Convert to AUSD" onPress={convert} busy={busy} />
          <Trail steps={steps} />
        </View>
      )}
      {err && <Body style={{ color: C.below, marginTop: 8 }}>{err}</Body>}
    </View>
  );
}
