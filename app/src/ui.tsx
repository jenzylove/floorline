import { useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, PanResponder, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import type { Candle } from "./data";

import { DARK, LIGHT } from "./theme";

/**
 * The active palette. Light: warm off-white, near-black ink, one chartreuse that marks the floor and good
 * news. Dark: the same roles on a deep olive-black. Filled by applyTheme() before the app tree renders.
 */
export const C = { ...LIGHT, floor: LIGHT.lime, bone: LIGHT.ink };

export function applyTheme(scheme: "light" | "dark") {
  const p = scheme === "dark" ? DARK : LIGHT;
  Object.assign(C, p, { floor: p.lime, bone: p.ink } as const);
}

export const F = {
  display: "Jost_700Bold",
  displayBlack: "Jost_800ExtraBold",
  semi: "Jost_600SemiBold",
  medium: "Jost_500Medium",
  body: "Jost_400Regular",
  mono: "Jost_500Medium",
  displayMed: "Jost_600SemiBold",
  monoBold: "Jost_600SemiBold",
};

const shadow = (): ViewStyle => ({ shadowColor: C.shadow, shadowOpacity: C.scheme === "dark" ? 0.4 : 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 3 } as const);

/** The soft lime-to-iridescent glow behind hero blocks (SVG, so it ships in an over-the-air update). */
export function Glow({ width, height, style, fadeTop }: { width: number; height: number; style?: ViewStyle; fadeTop?: boolean }) {
  return (
    <Svg width={width} height={height} style={[{ position: "absolute" }, style]} pointerEvents="none">
      <Defs>
        <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={C.bg} stopOpacity={fadeTop ? 1 : 0} />
          <Stop offset="0.25" stopColor={C.bg} stopOpacity="0" />
          <Stop offset="0.55" stopColor={C.bg} stopOpacity="0" />
          <Stop offset="1" stopColor={C.bg} stopOpacity="1" />
        </LinearGradient>
        <RadialGradient id="g1" cx="30%" cy="35%" r="55%">
          <Stop offset="0" stopColor="#D9F56B" stopOpacity={C.glow} />
          <Stop offset="1" stopColor="#D9F56B" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="g2" cx="78%" cy="62%" r="50%">
          <Stop offset="0" stopColor="#A9E3F0" stopOpacity={C.glow * 0.7} />
          <Stop offset="1" stopColor="#A9E3F0" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="g3" cx="62%" cy="20%" r="40%">
          <Stop offset="0" stopColor="#F4C7E4" stopOpacity={C.glow * 0.5} />
          <Stop offset="1" stopColor="#F4C7E4" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#g1)" />
      <Rect width={width} height={height} fill="url(#g2)" />
      <Rect width={width} height={height} fill="url(#g3)" />
      <Rect width={width} height={height} fill="url(#fade)" />
    </Svg>
  );
}

export function Card({ children, style, tint }: { children: ReactNode; style?: ViewStyle; tint?: "lime" | "below" }) {
  const s = sty() as any;
  return (
    <View style={[s.card, shadow(), tint === "lime" && { backgroundColor: C.limeSoft }, tint === "below" && { backgroundColor: C.belowSoft }, style]}>{children}</View>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const s = sty() as any;
  return <Text style={[s.label, style]}>{children}</Text>;
}

export function Big({ children, size = 44, color = C.ink, style }: { children: ReactNode; size?: number; color?: string; style?: TextStyle }) {
  return <Text style={[{ fontFamily: F.display, fontSize: size, color, letterSpacing: -size * 0.025, lineHeight: size * 1.08, fontVariant: ["tabular-nums"] }, style]}>{children}</Text>;
}

export function Title({ children, accent, size = 34 }: { children: ReactNode; accent?: string; size?: number }) {
  return (
    <Text style={{ fontFamily: F.display, fontSize: size, color: C.ink, letterSpacing: -size * 0.02, lineHeight: size * 1.1 }}>
      {children}
      {accent ? <Text style={{ color: C.limeInk }}> {accent}</Text> : null}
    </Text>
  );
}

export function Body({ children, style, muted }: { children: ReactNode; style?: TextStyle; muted?: boolean }) {
  const s = sty() as any;
  return <Text style={[s.body, muted && { color: C.mute }, style]}>{children}</Text>;
}

export function Hairline({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginVertical: 16 }, style]} />;
}

export function FloorRule({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 3, borderRadius: 2, backgroundColor: C.lime }, style]} />;
}

export function Button({ title, onPress, disabled, ghost, busy, small }: { title: string; onPress: () => void; disabled?: boolean; ghost?: boolean; busy?: boolean; small?: boolean }) {
  const s = sty() as any;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.btn, small && s.btnSmall, ghost && s.btnGhost, (disabled || busy) && { opacity: 0.35 }, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      {busy ? <ActivityIndicator color={ghost ? C.ink : C.onInk} /> : <Text style={[s.btnText, small && { fontSize: 15 }, ghost && { color: C.ink }]}>{title}</Text>}
    </Pressable>
  );
}

/** A tappable row with a title, a line of detail and an arrow: the app's way of offering a choice. */
export function Action({ title, detail, onPress, icon }: { title: string; detail: string; onPress: () => void; icon?: ReactNode }) {
  const s = sty() as any;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.action, pressed && { backgroundColor: C.pressed }]}>
      {icon ? <View style={s.actionIcon}>{icon}</View> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.semi, fontSize: 18, color: C.ink }}>{title}</Text>
        <Text style={{ fontFamily: F.body, fontSize: 14, color: C.mute, marginTop: 2 }}>{detail}</Text>
      </View>
      <Text style={{ fontFamily: F.semi, fontSize: 20, color: C.ink }}>→</Text>
    </Pressable>
  );
}

export function Row({ k, v, vColor, strong }: { k: string; v: ReactNode; vColor?: string; strong?: boolean }) {
  const s = sty() as any;
  return (
    <View style={s.row}>
      <Text style={s.rowK}>{k}</Text>
      <Text style={[s.rowV, strong && { fontFamily: F.semi, fontSize: 16 }, vColor ? { color: vColor } : null]}>{v}</Text>
    </View>
  );
}

export function Chips<T extends string | number>({ items, value, onChange, render }: { items: T[]; value: T; onChange: (v: T) => void; render: (v: T) => string }) {
  const s = sty() as any;
  return (
    <View style={s.chips}>
      {items.map((it) => (
        <Pressable key={String(it)} onPress={() => onChange(it)} style={[s.chip, it === value && s.chipOn]}>
          <Text style={[s.chipText, it === value && { color: C.onInk }]}>{render(it)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Two or three choices as one segmented control. */
export function Segment<T extends string>({ items, value, onChange, render }: { items: T[]; value: T; onChange: (v: T) => void; render: (v: T) => string }) {
  const s = sty() as any;
  return (
    <View style={s.segment}>
      {items.map((it) => (
        <Pressable key={it} onPress={() => onChange(it)} style={[s.segItem, it === value && s.segOn]}>
          <Text style={[s.segText, it === value && { color: C.ink }]}>{render(it)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Steps({ at, total }: { at: number; total: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, marginBottom: 18 }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= at ? C.ink : C.line }} />
      ))}
    </View>
  );
}

const explorer = (hash: string) => `https://monadscan.com/tx/${hash}`;

/** The transaction trail of the action in progress: each step and its hash, tappable to the explorer. */
export function Trail({ steps }: { steps: { label: string; hash?: string }[] }) {
  const s = sty() as any;
  if (!steps.length) return null;
  return (
    <View style={{ marginTop: 14 }}>
      {steps.map((st, i) => (
        <Pressable key={i} disabled={!st.hash} onPress={() => st.hash && Linking.openURL(explorer(st.hash))} style={s.trail}>
          <View style={[s.dot, { backgroundColor: st.hash ? C.lime : C.line }]} />
          <Text style={[s.trailText, { flex: 1 }]}>{st.label}</Text>
          <Text style={[s.trailText, { color: C.mute }]}>{st.hash ? `${st.hash.slice(0, 8)}…${st.hash.slice(-4)} ↗` : "confirm with your fingerprint"}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The signature interaction: MON's real price over the last day, with the floors on sale drawn across it.
 * Drag up or down on the chart to move your floor; it snaps to the nearest floor that is on sale.
 */
export function FloorChart({
  data,
  floors = [],
  floor,
  onPick,
  width,
  height = 210,
}: {
  data: Candle[];
  floors?: number[];
  floor?: number;
  onPick?: (strike: number) => void;
  width: number;
  height?: number;
}) {
  const g = useMemo(() => {
    if (data.length < 2) return undefined;
    const ys = data.map((d) => d.c);
    let lo = Math.min(...ys, ...floors);
    let hi = Math.max(...ys);
    const pad = (hi - lo) * 0.14 || hi * 0.02;
    lo -= pad;
    hi += pad;
    const x = (i: number) => (i / (data.length - 1)) * width;
    const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
    const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.c).toFixed(1)}`).join(" ");
    return { path, area: `${path} L${width},${height} L0,${height} Z`, y, lo, hi, lastX: x(data.length - 1), lastY: y(data[data.length - 1].c) };
  }, [data, floors.join(","), width, height]);

  const geo = useRef(g);
  geo.current = g;
  const pick = useRef(onPick);
  pick.current = onPick;
  const fl = useRef(floors);
  fl.current = floors;
  const [dragging, setDragging] = useState(false);
  const snap = (yPos: number) => {
    const G = geo.current;
    if (!G || !fl.current.length || !pick.current) return;
    const v = G.hi - (yPos / height) * (G.hi - G.lo);
    const best = fl.current.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    pick.current(best);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !!pick.current,
      onMoveShouldSetPanResponder: (_, gs) => !!pick.current && Math.abs(gs.dy) > 4,
      onPanResponderGrant: (e) => {
        setDragging(true);
        snap(e.nativeEvent.locationY);
      },
      onPanResponderMove: (e) => snap(e.nativeEvent.locationY),
      onPanResponderRelease: () => setDragging(false),
      onPanResponderTerminate: () => setDragging(false),
    }),
  ).current;

  if (!g) return <View style={{ height, justifyContent: "center" }}><ActivityIndicator color={C.ink} /></View>;
  const fy = floor !== undefined ? g.y(floor) : undefined;
  return (
    <View {...pan.panHandlers}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.ink} stopOpacity="0.07" />
            <Stop offset="1" stopColor={C.ink} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="cover" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.lime} stopOpacity="0.45" />
            <Stop offset="1" stopColor={C.lime} stopOpacity="0.05" />
          </LinearGradient>
        </Defs>
        <Path d={g.area} fill="url(#area)" />
        {floors.filter((f) => f !== floor).map((f) => (
          <Line key={f} x1={0} x2={width} y1={g.y(f)} y2={g.y(f)} stroke={C.ink} strokeOpacity={0.18} strokeDasharray="3 6" />
        ))}
        {fy !== undefined && (
          <>
            <Rect x={0} y={fy} width={width} height={Math.max(0, height - fy)} fill="url(#cover)" />
            <Line x1={0} x2={width} y1={fy} y2={fy} stroke={C.lime} strokeWidth={dragging ? 4 : 3} />
            <Rect x={width - 110} y={fy - 26} width={106} height={22} rx={11} fill={C.ink} />
            <SvgText x={width - 57} y={fy - 11} fill={C.onInk} fontSize={11} fontFamily={F.semi} textAnchor="middle">
              {`FLOOR $${floor!.toFixed(5)}`}
            </SvgText>
          </>
        )}
        <Path d={g.path} stroke={C.ink} strokeWidth={1.8} fill="none" />
        <Circle cx={g.lastX - 3} cy={g.lastY} r={4.5} fill={C.ink} />
      </Svg>
    </View>
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

const sty = () => ({
  card: { backgroundColor: C.card, borderRadius: 26, padding: 20 },
  label: { fontFamily: F.medium, fontSize: 13, color: C.mute, letterSpacing: 0.2 },
  body: { fontFamily: F.body, fontSize: 16, color: C.ink2, lineHeight: 23 },
  btn: { backgroundColor: C.ink, paddingVertical: 17, borderRadius: 999, alignItems: "center", marginTop: 14 },
  btnSmall: { paddingVertical: 11, paddingHorizontal: 18, marginTop: 0 },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.ink },
  btnText: { fontFamily: F.semi, fontSize: 17, color: C.onInk, letterSpacing: 0.1 },
  action: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16, paddingHorizontal: 4, borderRadius: 16 },
  actionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.limeSoft, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 8, gap: 14 },
  rowK: { fontFamily: F.body, fontSize: 15, color: C.mute, flexShrink: 1 },
  rowV: { fontFamily: F.medium, fontSize: 15, color: C.ink, flexShrink: 1, textAlign: "right", fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipText: { fontFamily: F.medium, fontSize: 14, color: C.ink },
  segment: { flexDirection: "row", backgroundColor: C.track, borderRadius: 999, padding: 4, marginTop: 10 },
  segItem: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: "center" },
  segOn: { backgroundColor: C.card, ...shadow() },
  segText: { fontFamily: F.medium, fontSize: 14, color: C.mute },
  trail: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 7 },
  trailText: { fontFamily: F.medium, fontSize: 13, color: C.ink },
  dot: { width: 9, height: 9, borderRadius: 5 },
} as const);
