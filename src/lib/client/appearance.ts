"use client";

import { useEffect } from "react";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, resolveTheme, type Appearance } from "@/lib/appearance";
import { useStoredJson } from "./useStored";

/** The chosen look (kept on this device) and a way to change part of it. */
export function useAppearance(): [Appearance, (change: Partial<Appearance>) => void] {
  const [stored, setStored] = useStoredJson<Partial<Appearance>>(APPEARANCE_KEY);
  const look: Appearance = { ...DEFAULT_APPEARANCE, ...stored };
  return [look, (change) => setStored({ ...look, ...change })];
}

/** Keeps <html> in step with the chosen look (and with the device's theme, for "system"). */
export function useApplyAppearance(): void {
  const [{ theme, accent, text }] = useAppearance();
  useEffect(() => {
    const root = document.documentElement;
    const media = matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const shown = resolveTheme(theme, media.matches);
      root.dataset.theme = shown;
      if (accent === "violet") delete root.dataset.accent;
      else root.dataset.accent = accent;
      if (text === "normal") delete root.dataset.text;
      else root.dataset.text = text;
      // The phone's status bar matches the page.
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", shown === "light" ? "#f7f6fb" : "#09080f");
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, accent, text]);
}
