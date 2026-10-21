import { Platform } from "react-native";

/**
 * The MARYX site the app works with: its API and the same accounts
 * (EXPO_PUBLIC_API_URL, or the live site). An empty value means the page's
 * own address — the web build served next to the API (the tests).
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://ai-six-gules-52.vercel.app").replace(/\/+$/, "");

/** The app's link scheme (app.json): the server trusts sign-ins from it. */
export const SCHEME = "maryx";

/** Where the site is, for its pages opened from the app (terms, privacy). */
export function siteUrl(path: string): string {
  const base = API_URL || (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${path}`;
}
