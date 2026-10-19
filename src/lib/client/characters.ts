"use client";

// «Мой персонаж»: the user's characters, loaded once and shared by the studio.

import { useEffect, useSyncExternalStore } from "react";
import type { Character, InlineImage } from "@/lib/types";
import { api } from "./api";

let list: Character[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Character[]) {
  list = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The user's characters: null until they're loaded. */
export function useCharacters(): Character[] | null {
  useEffect(() => {
    loading ??= api<Character[]>("/api/characters").then(set, (e) => {
      loading = null;
      console.error("Не удалось загрузить персонажей", e);
    });
  }, []);
  return useSyncExternalStore(subscribe, () => list, () => null);
}

export async function addCharacter(name: string, photos: InlineImage[]): Promise<Character> {
  const made = await api<Character>("/api/characters", { method: "POST", body: JSON.stringify({ name, photos }) });
  set([...(list ?? []), made]);
  return made;
}

export async function removeCharacter(id: string): Promise<void> {
  set((list ?? []).filter((c) => c.id !== id));
  await api(`/api/characters/${id}`, { method: "DELETE" });
}
