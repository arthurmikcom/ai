import { Platform, StyleSheet } from "react-native";

/** MARYX's colours (the site's dark theme). */
export const C = {
  bg: "#09080f",
  surface: "#14121d",
  surface2: "#1c1a28",
  line: "rgba(255,255,255,0.09)",
  lineStrong: "rgba(255,255,255,0.16)",
  text: "#f4f4f5",
  muted: "#a1a1aa",
  faint: "#71717a",
  accent: "#7c5cff",
  accentSoft: "rgba(124,92,255,0.18)",
  accentText: "#d4c8ff",
  danger: "#f87171",
  dangerSoft: "rgba(248,113,113,0.12)",
  success: "#6ee7b7",
} as const;

export const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  card: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 16 },
  input: {
    backgroundColor: C.surface,
    borderColor: C.lineStrong,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 10,
    color: C.text,
    fontSize: 16,
  },
  h1: { color: C.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 },
  h2: { color: C.text, fontSize: 18, fontWeight: "600" },
  body: { color: C.text, fontSize: 16, lineHeight: 23 },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  error: { color: C.danger, fontSize: 14, lineHeight: 20 },
});
