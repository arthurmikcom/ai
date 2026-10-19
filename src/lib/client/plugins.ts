"use client";

// «Плагины» in the browser: which ones the user has on, turning one on or off,
// and asking an example in a new chat.

import { useEffect, useState } from "react";
import type { PluginId } from "@/lib/plugins";
import { api } from "./api";

export function usePlugins(signedIn: boolean) {
  const [installed, setInstalled] = useState<PluginId[] | null>(null);
  const [busy, setBusy] = useState<PluginId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    api<{ installed: PluginId[] }>("/api/plugins").then(
      (r) => alive && setInstalled(r.installed),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [signedIn]);

  /** Turns a plugin on or off (shown at once, put back if the server says no). */
  const toggle = async (id: PluginId, on: boolean): Promise<boolean> => {
    setBusy(id);
    setError(null);
    setInstalled((list) => (list ? (on ? [...list, id] : list.filter((p) => p !== id)) : list));
    try {
      setInstalled((await api<{ installed: PluginId[] }>("/api/plugins", { method: "PUT", body: JSON.stringify({ id, on }) })).installed);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInstalled((list) => (list ? (on ? list.filter((p) => p !== id) : [...list, id]) : list));
      return false;
    } finally {
      setBusy(null);
    }
  };

  return { installed, busy, error, toggle, on: (id: PluginId) => Boolean(installed?.includes(id)) };
}

/** Leaves the question for the chat page, which asks it in a new chat as soon as it's ready. */
export function askInNewChat(text: string): void {
  try {
    sessionStorage.setItem("maryx:ask", text);
  } catch {
    // without storage the chat just opens
  }
}
