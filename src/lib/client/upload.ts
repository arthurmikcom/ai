"use client";

// A whole video for the chat, uploaded in parts (the server takes ~4 MB per
// request; phone videos are far bigger), with progress.

import { api, errorOf } from "./api";

/** Parts sent at once. */
const PARALLEL_PARTS = 3;

/** The video's type as the server takes it (phones don't always say it; the name does). */
export function videoMime(file: File): string {
  if (/^video\/(mp4|webm|quicktime)$/.test(file.type)) return file.type;
  if (/\.webm$/i.test(file.name)) return "video/webm";
  if (/\.mov$/i.test(file.name)) return "video/quicktime";
  return "video/mp4";
}

/**
 * Uploads the video; `onProgress` gets 0–100. Returns where it's stored.
 * Cancelled (`signal`), it stops and its parts are removed.
 */
export async function uploadVideo(
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<{ key: string; url: string; mime: string }> {
  const mime = videoMime(file);
  const { id, part } = await api<{ id: string; part: number }>("/api/uploads", {
    method: "POST",
    body: JSON.stringify({ mime, size: file.size }),
    signal,
  });
  const parts = Math.ceil(file.size / part);
  // A few parts go at once (a big video has hundreds); one that fails stops the rest.
  const stop = new AbortController();
  const sending = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let next = 0;
  let sent = 0;
  const sendPart = async (i: number) => {
    const body = file.slice(i * part, Math.min(file.size, (i + 1) * part));
    // A part that fails (a flaky connection) is tried again twice.
    for (let attempt = 0; ; attempt++) {
      sending.throwIfAborted();
      const res = await fetch(`/api/uploads/${id}?part=${i}`, { method: "PUT", body, signal: sending }).catch((e: unknown) => e as Error);
      if (res instanceof Response && res.ok) break;
      sending.throwIfAborted();
      if (attempt >= 2) throw res instanceof Response ? await errorOf(res) : new Error("Связь прервалась — видео не загрузилось.");
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    onProgress(Math.round((++sent / parts) * 95));
  };
  const worker = async () => {
    while (next < parts) await sendPart(next++);
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, parts) }, () => worker())).catch((err: unknown) => {
      stop.abort();
      throw err;
    });
    signal?.throwIfAborted();
  } catch (err) {
    void fetch(`/api/uploads/${id}`, { method: "DELETE" }).catch(() => {});
    throw err;
  }
  const done = await api<{ key: string; url: string }>(`/api/uploads/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ parts, mime }),
  });
  onProgress(100);
  return { ...done, mime };
}

/** A video taken out of the message before it was sent isn't kept. */
export function discardVideo(key: string): void {
  void fetch("/api/uploads", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }).catch(() => {});
}
