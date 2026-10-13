"use client";

// Generated media store. It lives at module level (not in a component) so
// that long video jobs keep polling while the user is on another page.

import { useEffect, useSyncExternalStore } from "react";
import type {
  GenerateRequest,
  GenerateResult,
  MediaFile,
  MediaItem,
  MediaKind,
  MediaOutput,
  ProviderId,
} from "@/lib/types";
import { mediaDB } from "./db";
import { base64ToBlob, uid } from "./util";

const POLL_MS = 5000;
const MAX_POLL_ERRORS = 5;

const items = new Map<string, MediaItem>();
const listeners = new Set<() => void>();
const snapshots = new Map<MediaKind, MediaItem[]>();
/** Items whose start request is still in flight in this page session. */
const inFlight = new Set<string>();
const pollErrors = new Map<string, number>();
let loading: Promise<void> | null = null;
let poller: ReturnType<typeof setInterval> | null = null;

function emit() {
  snapshots.clear();
  listeners.forEach((l) => l());
}

function put(item: MediaItem) {
  items.set(item.id, item);
  emit();
  mediaDB.put(item).catch((e) => console.error("Не удалось сохранить файл", e));
}

function patch(id: string, changes: Partial<MediaItem>) {
  const current = items.get(id);
  if (current) put({ ...current, ...changes });
}

const objectUrls = new WeakMap<Blob, string>();

/** A stable blob: URL for a stored file (created once, freed on delete). */
export function objectUrl(blob: Blob): string {
  let url = objectUrls.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    objectUrls.set(blob, url);
  }
  return url;
}

export function removeMedia(id: string) {
  for (const file of items.get(id)?.files ?? []) {
    const url = objectUrls.get(file.blob);
    if (url) URL.revokeObjectURL(url);
  }
  items.delete(id);
  emit();
  mediaDB.remove(id).catch((e) => console.error(e));
}

function ensureLoaded(): Promise<void> {
  loading ??= mediaDB
    .all()
    .then((saved) => {
      for (const item of saved) {
        // A pending item without a job id lost its request when the page reloaded.
        if (item.status === "pending" && !item.jobId && !inFlight.has(item.id)) {
          item.status = "failed";
          item.error = "Генерация прервана перезагрузкой страницы.";
          mediaDB.put(item).catch(() => {});
        }
        if (!items.has(item.id)) items.set(item.id, item);
      }
      emit();
      startPolling();
    })
    .catch((e) => console.error("Не удалось загрузить галерею", e));
  return loading;
}

async function download(provider: ProviderId, output: MediaOutput): Promise<MediaFile> {
  if (output.type === "base64") {
    return { blob: base64ToBlob(output.data, output.mime), mime: output.mime };
  }
  const res = await fetch(`/api/media?provider=${provider}&url=${encodeURIComponent(output.url)}`);
  if (!res.ok) throw new Error("Не удалось скачать результат");
  const blob = await res.blob();
  return { blob, mime: blob.type || "application/octet-stream" };
}

async function applyResult(id: string, result: GenerateResult) {
  const item = items.get(id);
  if (!item) return;
  if (result.status === "pending") {
    patch(id, { jobId: result.jobId, progress: result.progress });
    startPolling();
  } else if (result.status === "failed") {
    patch(id, { status: "failed", error: result.error });
  } else {
    try {
      const files = await Promise.all(result.outputs.map((o) => download(item.provider, o)));
      patch(id, { status: "succeeded", files, progress: undefined });
    } catch (e) {
      patch(id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }
}

async function pollOnce() {
  const pending = [...items.values()].filter((i) => i.status === "pending" && i.jobId);
  if (pending.length === 0) {
    if (poller) clearInterval(poller);
    poller = null;
    return;
  }
  await Promise.all(
    pending.map(async (item) => {
      const params = new URLSearchParams({
        provider: item.provider,
        kind: item.kind,
        jobId: item.jobId!,
      });
      try {
        const res = await fetch(`/api/generate/status?${params}`);
        const result = (await res.json()) as GenerateResult;
        if (res.status >= 500) throw new Error(result.status === "failed" ? result.error : "");
        pollErrors.delete(item.id);
        if (items.get(item.id)?.status === "pending") await applyResult(item.id, result);
      } catch (e) {
        const errors = (pollErrors.get(item.id) ?? 0) + 1;
        pollErrors.set(item.id, errors);
        if (errors >= MAX_POLL_ERRORS) {
          patch(item.id, {
            status: "failed",
            error: e instanceof Error && e.message ? e.message : "Не удалось узнать статус задачи.",
          });
        }
      }
    }),
  );
}

function startPolling() {
  if (poller) return;
  if (![...items.values()].some((i) => i.status === "pending" && i.jobId)) return;
  poller = setInterval(() => void pollOnce(), POLL_MS);
}

export async function generate(req: GenerateRequest): Promise<void> {
  await ensureLoaded();
  const id = uid();
  inFlight.add(id);
  put({
    id,
    kind: req.kind,
    prompt: req.prompt,
    provider: req.provider,
    model: req.model,
    aspectRatio: req.aspectRatio,
    status: "pending",
    files: [],
    createdAt: Date.now(),
  });
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    const result = (await res.json().catch(() => ({
      status: "failed",
      error: `Ошибка сервера (${res.status})`,
    }))) as GenerateResult;
    await applyResult(id, result);
  } catch (e) {
    patch(id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
  } finally {
    inFlight.delete(id);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: MediaItem[] = [];

export function useMediaItems(kind: MediaKind): MediaItem[] {
  useEffect(() => {
    void ensureLoaded();
  }, []);
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
