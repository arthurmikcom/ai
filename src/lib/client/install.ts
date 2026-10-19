"use client";

// "Установить приложение": the browser's install prompt (Chrome, Edge, Android) is
// kept from page load, so a button can show it later. iPhone has no prompt:
// there the app is added from the Share menu.

import { useSyncExternalStore } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** "prompt": a button can install it; "ios": add it from the Share menu; null: nothing to offer (or installed). */
function state(): "prompt" | "ios" | null {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return null;
  if (deferred) return "prompt";
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : null;
}

export function useInstall(): "prompt" | "ios" | null {
  return useSyncExternalStore(subscribe, state, () => null);
}

/** Shows the browser's install dialog; true when the app was installed. */
export async function installApp(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  emit();
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}
