// File storage for chat attachments and generated media.
// A Vercel Blob store connected to the project (Vercel → Storage → Connect
// Project) → private Blob store (used on Vercel). Otherwise files go to
// .data/files/ on this machine (local development).
// Files are never public: the browser reads them through /api/files, which
// checks that the file belongs to the signed-in user.

import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { BlobAccessError, BlobError, BlobStoreNotFoundError, BlobStoreSuspendedError, del, get, list, put } from "@vercel/blob";
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

/** How Blob calls reach the store: an explicit token or store id, or {} to let the SDK read BLOB_READ_WRITE_TOKEN. */
type BlobAuth = { token?: string; storeId?: string };

/**
 * The connected Blob store, or null when there is none. Vercel connects a
 * store with BLOB_READ_WRITE_TOKEN, or with only BLOB_STORE_ID (the deployment
 * then signs in with its OIDC token), and a custom prefix renames both.
 */
function blobAuth(): BlobAuth | null {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return {};
  const vars = Object.entries(process.env).flatMap(([name, value]) => (value?.trim() ? [[name, value.trim()] as const] : []));
  const tokens = vars.filter(([name, value]) => name.endsWith("_READ_WRITE_TOKEN") && value.startsWith("vercel_blob_rw_"));
  if (tokens.length === 1) return { token: tokens[0][1] };
  // OIDC tokens exist on Vercel (and locally after `vercel env pull`).
  if (!process.env.VERCEL && !process.env.VERCEL_OIDC_TOKEN) return null;
  const named = process.env.BLOB_STORE_ID?.trim();
  if (named) return { storeId: named };
  const set = new Set(vars.map(([name]) => name));
  const stores = vars.filter(
    ([name, value]) =>
      name.endsWith("_STORE_ID") && (value.startsWith("store_") || set.has(`${name.slice(0, -"_STORE_ID".length)}_WEBHOOK_PUBLIC_KEY`)),
  );
  return stores.length === 1 ? { storeId: stores[0][1] } : null;
}

function blobEnabled(): boolean {
  return blobAuth() !== null;
}

/** Whether a Blob error means the store can't be reached at all (not connected, no access, gone). */
function unreachable(err: unknown): boolean {
  if (err instanceof BlobAccessError || err instanceof BlobStoreNotFoundError || err instanceof BlobStoreSuspendedError) return true;
  return err instanceof BlobError && /credentials|read-write token|OIDC/i.test(err.message);
}

/** Where files are kept, for the setup check: "blob", "local" (this machine) or "none" (on Vercel without Blob). */
export function storageKind(): "blob" | "local" | "none" {
  if (blobEnabled()) return "blob";
  return process.env.VERCEL ? "none" : "local";
}

let lastCheck: { at: number; error?: string } | undefined;

/**
 * Whether the Blob store answers, for the setup check: undefined when it does,
 * else what went wrong. Remembered for a few minutes, as each call is a paid
 * Blob operation.
 */
export async function blobProblem(): Promise<string | undefined> {
  if (lastCheck && Date.now() - lastCheck.at < 5 * 60_000) return lastCheck.error;
  let error: string | undefined;
  try {
    await list({ prefix: "users/", limit: 1, ...blobAuth() });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  lastCheck = { at: Date.now(), error };
  return error;
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
  const auth = blobAuth();
  if (!auth && process.env.VERCEL) throw new StorageUnavailableError();
  if (auth) {
    try {
      await put(key, body, { access: "private", contentType: mime, addRandomSuffix: false, ...auth });
    } catch (err) {
      if (!unreachable(err)) throw err;
      console.error("Vercel Blob is not reachable:", err);
      throw new StorageUnavailableError();
    }
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
  const auth = blobAuth();
  if (auth) {
    const res = await get(key, { access: "private", ...auth });
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
  const auth = blobAuth();
  if (auth) {
    await del(valid, auth);
    return;
  }
  await Promise.all(valid.map((k) => unlink(path.join(LOCAL_ROOT, k)).catch(() => {})));
}

/** Removes every file of a user (used when the account is deleted). */
export async function deleteUserFiles(userId: string): Promise<void> {
  const prefix = userPrefix(userId);
  const auth = blobAuth();
  if (auth) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000, ...auth });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url), auth);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return;
  }
  await rm(path.join(LOCAL_ROOT, prefix), { recursive: true, force: true });
}
