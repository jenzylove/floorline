import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Light and dark palettes. `C` (in ui.tsx) is filled from one of these before each render of the app tree;
 * the tree is remounted when the theme changes, so every screen redraws with the new colours.
 */
export const LIGHT = {
  bg: "#F4F4EE",
  card: "#FFFFFF",
  glass: "rgba(255,255,255,0.94)",
  ink: "#121410",
  onInk: "#FFFFFF",
  ink2: "#3B3E36",
  mute: "#8A8D82",
  line: "#E4E5DC",
  track: "#E8E9E0",
  pressed: "#ECEDE4",
  lime: "#B8E62E",
  limeInk: "#3F5A00",
  limeSoft: "#EEF8CF",
  below: "#E0522D",
  belowSoft: "#FCE8E1",
  glow: 0.85,
  shadow: "#3B4A10",
  scheme: "light" as "light" | "dark",
};

export const DARK: typeof LIGHT = {
  bg: "#0D0E0B",
  card: "#17190F",
  glass: "rgba(28,30,22,0.94)",
  ink: "#F1F2EA",
  onInk: "#0D0E0B",
  ink2: "#C7C9BE",
  mute: "#8B8E82",
  line: "#2A2C24",
  track: "#22241C",
  pressed: "#20231A",
  lime: "#C6F23C",
  limeInk: "#C6F23C",
  limeSoft: "#1E2709",
  below: "#FF7A59",
  belowSoft: "#2B150E",
  glow: 0.35,
  shadow: "#000000",
  scheme: "dark",
};

export type ThemePref = "system" | "light" | "dark";
const KEY = "floorline.theme";

export async function loadPref(): Promise<ThemePref> {
  try {
    if (Platform.OS === "web") return "system";
    const v = await SecureStore.getItemAsync(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export async function savePref(p: ThemePref) {
  try {
    if (Platform.OS !== "web") await SecureStore.setItemAsync(KEY, p);
  } catch {
    /* the choice still applies for this session */
  }
}
