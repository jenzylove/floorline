import { useMemo, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";
import type { Candle } from "./data";

export const C = {
  ink: "#0B0C0A",
  ink2: "#151612",
  bone: "#F2EFE6",
  mute: "#8E8A7F",
  line: "#2A2B25",
  floor: "#D8FF3D",
  below: "#FF7A59",
};

export const F = {
  display: "BricolageGrotesque_800ExtraBold",
  displayMed: "BricolageGrotesque_600SemiBold",
  body: "BricolageGrotesque_400Regular",
  mono: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_700Bold",
};

export function Label({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}

export function Big({ children, size = 44, color = C.bone, style }: { children: ReactNode; size?: number; color?: string; style?: TextStyle }) {
  return <Text style={[{ fontFamily: F.display, fontSize: size, color, letterSpacing: -size * 0.03, lineHeight: size * 1.05 }, style]}>{children}</Text>;
}

export function Body({ children, style, muted }: { children: ReactNode; style?: TextStyle; muted?: boolean }) {
  return <Text style={[s.body, muted && { color: C.mute }, style]}>{children}</Text>;
}

export function Hairline({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginVertical: 18 }, style]} />;
}

export function FloorRule({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 2, backgroundColor: C.floor }, style]} />;
}

export function Button({ title, onPress, disabled, ghost, busy }: { title: string; onPress: () => void; disabled?: boolean; ghost?: boolean; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.btn, ghost && s.btnGhost, (disabled || busy) && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      {busy ? <ActivityIndicator color={ghost ? C.floor : C.ink} /> : <Text style={[s.btnText, ghost && { color: C.floor }]}>{title}</Text>}
    </Pressable>
  );
}

export function Row({ k, v, vColor }: { k: string; v: ReactNode; vColor?: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowK}>{k}</Text>
      <Text style={[s.rowV, vColor ? { color: vColor } : null]}>{v}</Text>
    </View>
  );
}

export function Chips<T extends string | number>({ items, value, onChange, render }: { items: T[]; value: T; onChange: (v: T) => void; render: (v: T) => string }) {
  return (
    <View style={s.chips}>
      {items.map((it) => (
        <Pressable key={String(it)} onPress={() => onChange(it)} style={[s.chip, it === value && s.chipOn]}>
          <Text style={[s.chipText, it === value && { color: C.ink }]}>{render(it)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const explorer = (hash: string) => `https://monadscan.com/tx/${hash}`;

/** The transaction trail of the action in progress: each step and its hash, tappable to the explorer. */
export function Trail({ steps }: { steps: { label: string; hash?: string }[] }) {
  if (!steps.length) return null;
  return (
    <View style={{ marginTop: 14 }}>
      {steps.map((st, i) => (
        <Pressable key={i} disabled={!st.hash} onPress={() => st.hash && Linking.openURL(explorer(st.hash))} style={s.trail}>
          <Text style={[s.mono, { color: st.hash ? C.floor : C.mute }]}>{st.hash ? "●" : "○"}</Text>
          <Text style={[s.mono, { color: C.bone, flex: 1 }]}>{st.label}</Text>
          <Text style={[s.mono, { color: C.mute }]}>{st.hash ? `${st.hash.slice(0, 8)}…${st.hash.slice(-4)} ↗` : "signing…"}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The signature visual: MON's real price over the last day, and the floor you are buying drawn as a
 * line across it. Anything under the line is the part protection pays for.
 */
export function FloorChart({ data, floor, width, height = 170 }: { data: Candle[]; floor?: number; width: number; height?: number }) {
  const g = useMemo(() => {
    if (data.length < 2) return undefined;
    const xs = data.map((d) => d.t);
    const ys = data.map((d) => d.c);
    let lo = Math.min(...ys, floor ?? Infinity);
    let hi = Math.max(...ys);
    const pad = (hi - lo) * 0.12 || hi * 0.02;
    lo -= pad;
    hi += pad;
    const x = (t: number) => ((t - xs[0]) / (xs[xs.length - 1] - xs[0])) * width;
    const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
    const path = data.map((d, i) => `${i ? "L" : "M"}${x(d.t).toFixed(1)},${y(d.c).toFixed(1)}`).join(" ");
    const area = `${path} L${width},${height} L0,${height} Z`;
    return { path, area, floorY: floor !== undefined ? y(floor) : undefined, last: data[data.length - 1], lastY: y(data[data.length - 1].c) };
  }, [data, floor, width, height]);

  if (!g) return <View style={{ height, justifyContent: "center" }}><ActivityIndicator color={C.floor} /></View>;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={C.bone} stopOpacity="0.10" />
          <Stop offset="1" stopColor={C.bone} stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id="cover" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={C.floor} stopOpacity="0.22" />
          <Stop offset="1" stopColor={C.floor} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>
      <Path d={g.area} fill="url(#fade)" />
      <Path d={g.path} stroke={C.bone} strokeWidth={1.6} fill="none" />
      {g.floorY !== undefined && (
        <>
          <Rect x={0} y={g.floorY} width={width} height={Math.max(0, height - g.floorY)} fill="url(#cover)" />
          <Line x1={0} x2={width} y1={g.floorY} y2={g.floorY} stroke={C.floor} strokeWidth={2} />
          <SvgText x={width - 4} y={g.floorY - 6} fill={C.floor} fontSize={10} fontFamily={F.mono} textAnchor="end">
            YOUR FLOOR
          </SvgText>
        </>
      )}
    </Svg>
  );
}

export const usd = (v: number, dp = 2) => `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const price = (v: number) => `$${v.toFixed(v < 1 ? 5 : 2)}`;
export const pct = (v: number, dp = 0) => `${(v * 100).toFixed(dp)}%`;
export function untilText(sec: number) {
  if (sec <= 0) return "expired";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

const s = StyleSheet.create({
  label: { fontFamily: F.mono, fontSize: 11, color: C.mute, letterSpacing: 1.6, textTransform: "uppercase" },
  body: { fontFamily: F.body, fontSize: 16, color: C.bone, lineHeight: 23 },
  mono: { fontFamily: F.mono, fontSize: 12 },
  btn: { backgroundColor: C.floor, paddingVertical: 17, borderRadius: 999, alignItems: "center", marginTop: 14 },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.floor },
  btnText: { fontFamily: F.displayMed, fontSize: 17, color: C.ink, letterSpacing: -0.2 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 7, gap: 14 },
  rowK: { fontFamily: F.mono, fontSize: 12, color: C.mute, letterSpacing: 0.6, flexShrink: 1 },
  rowV: { fontFamily: F.mono, fontSize: 13, color: C.bone, flexShrink: 1, textAlign: "right" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.floor, borderColor: C.floor },
  chipText: { fontFamily: F.mono, fontSize: 12, color: C.bone },
  trail: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 6 },
});
