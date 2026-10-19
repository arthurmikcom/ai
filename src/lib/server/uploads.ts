// A whole video for the chat, uploaded in parts: the platform takes at most
// ~4.5 MB per request, phone videos are far bigger. Each part is stored on its
// own, then joined into one file in the user's attachments.

import { deleteFiles, getFile, isValidKey, newKey, putFile, userPrefix } from "./storage";

/** The biggest video the chat takes. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** One part: well under the platform's request limit. */
export const UPLOAD_PART_BYTES = 4 * 1024 * 1024;
export const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const UPLOAD_ID = /^[0-9a-f-]{36}$/;

export function isUploadId(id: string): boolean {
  return UPLOAD_ID.test(id);
}

export function partKey(userId: string, uploadId: string, part: number): string {
  return `${userPrefix(userId)}uploads/${uploadId}-${part}.bin`;
}

export function maxParts(): number {
  return Math.ceil(MAX_VIDEO_BYTES / UPLOAD_PART_BYTES);
}

/** An uploaded video as the chat sends it: one of this user's attachments. */
export function isOwnVideoKey(userId: string, key: string): boolean {
  return isValidKey(key) && key.startsWith(`${userPrefix(userId)}attachments/`) && /\.(mp4|webm|mov)$/.test(key);
}

/**
 * Joins the parts into one stored video (streamed: it's never all in memory)
 * and removes them. Returns its key, or null when a part is missing.
 */
export async function joinParts(userId: string, uploadId: string, parts: number, mime: string): Promise<string | null> {
  const keys = Array.from({ length: parts }, (_, i) => partKey(userId, uploadId, i));
  const key = newKey(userId, "attachments", mime);
  let next = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let missing = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (next >= keys.length) {
            controller.close();
            return;
          }
          const part = await getFile(keys[next++]);
          if (!part) {
            missing = true;
            controller.error(new Error("part missing"));
            return;
          }
          reader = part.body.getReader();
        }
        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          continue;
        }
        controller.enqueue(value);
        return;
      }
    },
  });
  try {
    await putFile(key, body, mime, { multipart: true });
  } catch (err) {
    await deleteFiles([key]).catch(() => {});
    if (missing) return null;
    throw err;
  } finally {
    await deleteFiles(keys).catch(() => {});
  }
  return key;
}
