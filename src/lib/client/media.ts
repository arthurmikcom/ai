"use client";

// The gallery lives on the server; this module keeps a shared in-memory copy
// and polls pending jobs. It sits at module level (not in a component) so
// that long video jobs keep updating while the user is on another page.

import { useEffect, useSyncExternalStore } from "react";
import type { GenerateRequest, MediaItem, MediaKind } from "@/lib/types";
import { api, ApiError } from "./api";
import { uid } from "./util";

const POLL_MS = 5000;

const items = new Map<string, MediaItem>();
const listeners = new Set<() => void>();
const snapshots = new Map<MediaKind, MediaItem[]>();
const loaded = new Map<MediaKind, Promise<void>>();
let poller: ReturnType<typeof setInterval> | null = null;

function emit() {
  snapshots.clear();
  listeners.forEach((l) => l());
}

function put(item: MediaItem) {
  items.set(item.id, item);
  emit();
  if (item.status === "pending") startPolling();
}

function ensureLoaded(kind: MediaKind): Promise<void> {
  let promise = loaded.get(kind);
  if (!promise) {
    promise = api<MediaItem[]>(`/api/media?kind=${kind}`).then((list) => {
      for (const item of list) if (!items.has(item.id)) items.set(item.id, item);
      emit();
      startPolling();
    });
    promise.catch(() => loaded.delete(kind));
    loaded.set(kind, promise);
  }
  return promise;
}

async function pollOnce() {
  const pending = [...items.values()].filter((i) => i.status === "pending" && !i.id.startsWith("tmp-"));
  if (pending.length === 0) {
    if (poller) clearInterval(poller);
    poller = null;
    return;
  }
  await Promise.all(
    pending.map(async (item) => {
      try {
        const next = await api<MediaItem>(`/api/media/${item.id}`);
        if (items.has(item.id)) put(next);
      } catch (e) {
        console.error("Не удалось узнать статус", e);
      }
    }),
  );
}

function startPolling() {
  if (poller) return;
  poller = setInterval(() => void pollOnce(), POLL_MS);
}

export async function generate(req: GenerateRequest): Promise<void> {
  // Placeholder card while the request is in flight (images can take a minute), with the photos being edited.
  const tempId = `tmp-${uid()}`;
  const { images, ...shown } = req;
  const inputs = images?.map((i) => ({ url: `data:${i.mime};base64,${i.data}`, mime: i.mime }));
  put({ id: tempId, ...shown, inputs, status: "pending", files: [], createdAt: Date.now() });
  let result: MediaItem;
  try {
    result = await api<MediaItem>("/api/generate", { method: "POST", body: JSON.stringify(req) });
  } catch (e) {
    result = {
      id: tempId,
      ...shown,
      inputs,
      status: "failed",
      // The platform refuses big requests before they reach us (with no message of ours).
      error: e instanceof ApiError && e.status === 413 ? "Фото слишком большое — попробуйте другое." : e instanceof Error ? e.message : String(e),
      errorCode: e instanceof ApiError ? e.code : undefined,
      files: [],
      createdAt: Date.now(),
    };
  }
  items.delete(tempId);
  put(result);
}

/**
 * "✨ Улучшить": MARYX rewrites a short idea into a detailed prompt for a
 * picture or clip (with `photo`, for what to do with the user's photo). Counts as one message.
 */
export async function enhancePrompt(kind: MediaKind, prompt: string, photo = false): Promise<string> {
  const res = await api<{ prompt: string }>("/api/prompt", { method: "POST", body: JSON.stringify({ kind, prompt, photo }) });
  return res.prompt;
}

/** A gallery item made outside the studio (a video answer in the chat): followed until it's ready. */
export function track(item: MediaItem) {
  put(item);
}

/** Items being loaded by id, and ones that are gone (deleted from the gallery). */
const fetching = new Set<string>();
const gone = new Set<string>();

/**
 * One gallery item by id (a chat's video answer), loaded once and followed
 * until it's ready: undefined while loading, null once it was deleted.
 */
export function useMediaItem(id: string | undefined): MediaItem | null | undefined {
  useEffect(() => {
    if (!id || items.has(id) || gone.has(id) || fetching.has(id)) return;
    fetching.add(id);
    api<MediaItem>(`/api/media/${id}`)
      .then(put, (e) => {
        if (e instanceof ApiError && e.status === 404) {
          gone.add(id);
          emit();
        }
      })
      .finally(() => fetching.delete(id));
  }, [id]);
  return useSyncExternalStore(
    subscribe,
    () => (id ? (items.get(id) ?? (gone.has(id) ? null : undefined)) : undefined),
    () => undefined,
  );
}

export async function removeMedia(id: string) {
  items.delete(id);
  // A chat that shows it says it's gone.
  gone.add(id);
  emit();
  if (!id.startsWith("tmp-")) await api(`/api/media/${id}`, { method: "DELETE" }).catch(console.error);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: MediaItem[] = [];

export function useMediaItems(kind: MediaKind): MediaItem[] {
  useEffect(() => {
    ensureLoaded(kind).catch((e) => console.error("Не удалось загрузить галерею", e));
  }, [kind]);
  return useSyncExternalStore(
    subscribe,
    () => {
      let snapshot = snapshots.get(kind);
      if (!snapshot) {
        snapshot = [...items.values()]
          .filter((i) => i.kind === kind)
          .sort((a, b) => b.createdAt - a.createdAt);
        snapshots.set(kind, snapshot);
      }
      return snapshot;
    },
    () => EMPTY,
  );
}
