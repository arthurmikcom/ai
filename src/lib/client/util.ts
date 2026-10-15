import type { Attachment } from "@/lib/types";

export function uid(): string {
  // randomUUID needs a secure context (https or localhost); fall back otherwise.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function base64ToBlob(data: string, mime: string): Blob {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

/** Reads a newline-delimited JSON response one object at a time. */
export async function* readNdjson<T>(res: Response): AsyncGenerator<T> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as T;
}

const MAX_IMAGE_SIDE = 1568;

/**
 * Shrinks an image so its longest side fits what the vision models actually
 * use, and re-encodes it as JPEG. Keeps requests and stored chats small.
 */
export async function imageToAttachment(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas недоступен");
  ctx.fillStyle = "#ffffff"; // JPEG has no transparency
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mime: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1), name: file.name };
}

/** Documents the chat accepts, by file extension (browsers often leave file.type empty). */
const DOCUMENT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
};

/** For <input accept>: images plus every document type. */
export const ATTACH_ACCEPT = `image/*,${Object.keys(DOCUMENT_MIME).map((e) => `.${e}`).join(",")}`;

/** Largest document we upload (the server and Vercel cap requests at a few MB). */
export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;

export function documentMime(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return DOCUMENT_MIME[ext] ?? null;
}

export function isDocumentAttachment(a: Pick<Attachment, "mime">): boolean {
  return !a.mime.startsWith("image/");
}

/** Reads a document as base64 for upload; null when it's too big. */
export async function documentToAttachment(file: File): Promise<Attachment | null> {
  const mime = documentMime(file);
  if (!mime || file.size > MAX_DOCUMENT_BYTES) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mime, data: btoa(binary), name: file.name };
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day && new Date(ts).getDate() === new Date().getDate()) return "Сегодня";
  if (diff < 2 * day) return "Вчера";
  if (diff < 7 * day) return "На этой неделе";
  if (diff < 30 * day) return "В этом месяце";
  return "Раньше";
}
