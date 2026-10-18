// File storage for chat attachments and generated media.
// BLOB_READ_WRITE_TOKEN set → private Vercel Blob store (used on Vercel).
// Otherwise files go to .data/files/ on this machine (local development).
// Files are never public: the browser reads them through /api/files, which
// checks that the file belongs to the signed-in user.

import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { del, get, list, put } from "@vercel/blob";
import { StorageUnavailableError } from "./errors";

const LOCAL_ROOT = path.join(process.cwd(), ".data", "files");
const KEY_PATTERN = /^users\/[\w-]+\/[\w-]+\/[\w-]+\.[a-z0-9]+$/;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXTENSIONS).map(([m, e]) => [e, m]));

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function userPrefix(userId: string): string {
  return `users/${userId}/`;
}

/** Builds a fresh storage key such as users/<id>/media/<uuid>.png */
export function newKey(userId: string, folder: "media" | "attachments", mime: string): string {
  const ext = EXTENSIONS[mime.split(";")[0].trim()] ?? "bin";
  return `${userPrefix(userId)}${folder}/${crypto.randomUUID()}.${ext}`;
}

export function mimeOfKey(key: string): string {
  return MIME_BY_EXT[key.split(".").pop() ?? ""] ?? "application/octet-stream";
}

/** URL the browser uses to read a stored file. */
export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}

export async function putFile(
  key: string,
  body: Buffer | ReadableStream<Uint8Array>,
  mime: string,
): Promise<void> {
  if (!isValidKey(key)) throw new Error(`Invalid storage key: ${key}`);
  // On Vercel the function's own disk is read-only: files need Blob there.
  if (!blobEnabled() && process.env.VERCEL) throw new StorageUnavailableError();
  if (blobEnabled()) {
    await put(key, body, { access: "private", contentType: mime, addRandomSuffix: false });
    return;
  }
  const file = path.join(LOCAL_ROOT, key);
  await mkdir(path.dirname(file), { recursive: true });
  if (Buffer.isBuffer(body)) {
    await writeFile(file, body);
  } else {
    await writeFile(file, Readable.fromWeb(body as import("node:stream/web").ReadableStream));
  }
}

export async function getFile(
  key: string,
): Promise<{ body: ReadableStream<Uint8Array>; size?: number } | null> {
  if (!isValidKey(key)) return null;
  if (blobEnabled()) {
    const res = await get(key, { access: "private" });
    if (!res || res.statusCode !== 200) return null;
    return { body: res.stream, size: res.blob.size };
  }
  const file = path.join(LOCAL_ROOT, key);
  try {
    const { size } = await stat(file);
    return { body: Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, size };
  } catch {
    return null;
  }
}

export async function readFileBase64(key: string): Promise<string | null> {
  if (!isValidKey(key)) return null;
  if (blobEnabled()) {
    const file = await getFile(key);
    return file ? Buffer.from(await new Response(file.body).arrayBuffer()).toString("base64") : null;
  }
  try {
    return (await readFile(path.join(LOCAL_ROOT, key))).toString("base64");
  } catch {
    return null;
  }
}

export async function deleteFiles(keys: string[]): Promise<void> {
  const valid = keys.filter(isValidKey);
  if (valid.length === 0) return;
  if (blobEnabled()) {
    await del(valid);
    return;
  }
  await Promise.all(valid.map((k) => unlink(path.join(LOCAL_ROOT, k)).catch(() => {})));
}

/** Removes every file of a user (used when the account is deleted). */
export async function deleteUserFiles(userId: string): Promise<void> {
  const prefix = userPrefix(userId);
  if (blobEnabled()) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return;
  }
  await rm(path.join(LOCAL_ROOT, prefix), { recursive: true, force: true });
}
