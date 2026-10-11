import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

// The same ground and mark as the app icon and the system splash, so launch reads as one continuous moment.
const INK = "#121410";
const BONE = "#f4f4ee";
const LIME = "#b8e62e";
const MIN_MS = 1600;
const MAX_MS = 6000; // whatever happens underneath, the launch never stays up longer than this

/** Opening moment: the price line settles in, the floor draws under it, then the app fades up. */
export function Launch({ ready }: { ready: boolean }) {
  const [gone, setGone] = useState(false);
  const started = useRef(Date.now());
  const line = useRef(new Animated.Value(0)).current;
  const floor = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(line, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(floor, { toValue: 1, duration: 520, easing: Easing.out(Easing.exp), useNativeDriver: true }),
    ]).start();
    // while the app is still loading, the floor breathes instead of the screen sitting still
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    ).start();
  }, [line, floor, breathe]);

  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(0, MIN_MS - (Date.now() - started.current));
    const t = setTimeout(() => {
      Animated.timing(out, { toValue: 0, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => setGone(true));
    }, wait);
    return () => clearTimeout(t);
  }, [ready, out]);

  useEffect(() => {
    const t = setTimeout(() => setGone(true), MAX_MS);
    return () => clearTimeout(t);
  }, []);

  if (gone) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: INK, alignItems: "center", justifyContent: "center", opacity: out, zIndex: 1000, elevation: 1000 }]}>
      <Animated.View style={{ opacity: line, transform: [{ translateY: line.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
        <Svg width={132} height={62} viewBox="8 10 48 22">
          <Path d="M12 27 L22 21 L31 30 L41 15 L52 23" fill="none" stroke={BONE} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Animated.View>
      <View style={{ width: 110, height: 19, marginTop: 14 }}>
        <Animated.View
          style={{
            flex: 1,
            borderRadius: 10,
            backgroundColor: LIME,
            opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }),
            transform: [{ scaleX: floor }],
          }}
        />
      </View>
    </Animated.View>
  );
}
