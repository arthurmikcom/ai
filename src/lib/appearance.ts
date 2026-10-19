// The look of the app: theme, accent colour and text size. Chosen in Settings,
// kept on this device, and set on <html> before the page paints.

export type Theme = "dark" | "light" | "system";
export type Accent = "violet" | "blue" | "emerald" | "rose" | "amber" | "cyan";
export type TextSize = "small" | "normal" | "large";

export interface Appearance {
  theme: Theme;
  accent: Accent;
  text: TextSize;
}

export const APPEARANCE_KEY = "maryx:appearance";
export const DEFAULT_APPEARANCE: Appearance = { theme: "dark", accent: "violet", text: "normal" };

export const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Тёмная" },
  { id: "light", label: "Светлая" },
  { id: "system", label: "Как в системе" },
];

/** `color`: the swatch (the accent's main shade). */
export const ACCENTS: { id: Accent; label: string; color: string }[] = [
  { id: "violet", label: "Фиолетовый", color: "#a68aff" },
  { id: "blue", label: "Синий", color: "#75a1ff" },
  { id: "emerald", label: "Изумрудный", color: "#45d29a" },
  { id: "rose", label: "Розовый", color: "#ff769d" },
  { id: "amber", label: "Янтарный", color: "#ffb547" },
  { id: "cyan", label: "Бирюзовый", color: "#45cbee" },
];

export const TEXT_SIZES: { id: TextSize; label: string }[] = [
  { id: "small", label: "Мельче" },
  { id: "normal", label: "Обычный" },
  { id: "large", label: "Крупнее" },
];

/** The theme to show: "system" follows the device. */
export function resolveTheme(theme: Theme, prefersLight: boolean): "dark" | "light" {
  return theme === "system" ? (prefersLight ? "light" : "dark") : theme;
}

/**
 * Sets the saved look on <html> before the first paint (an inline script in
 * the layout), so a light theme never flashes dark. Mirrors applyAppearance.
 */
export const APPEARANCE_SCRIPT = `(function(){try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})||"{}")||{};var d=document.documentElement;d.dataset.theme=a.theme==="light"?"light":a.theme==="system"&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";if(a.accent&&a.accent!=="violet")d.dataset.accent=String(a.accent);if(a.text==="small"||a.text==="large")d.dataset.text=a.text;}catch(e){}})();`;
