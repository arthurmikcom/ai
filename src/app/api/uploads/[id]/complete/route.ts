import { StorageUnavailableError } from "@/lib/server/errors";
import { jsonError, requireUser, storageUnavailable } from "@/lib/server/http";
import { fileUrl } from "@/lib/server/storage";
import { isUploadId, joinParts, maxParts, VIDEO_MIME } from "@/lib/server/uploads";

export const maxDuration = 300;

/** The last step: the parts become one video; its key goes with the chat message. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const id = (await params).id;
  const body = (await request.json().catch(() => null)) as { parts?: unknown; mime?: unknown } | null;
  const parts = body?.parts;
  if (!isUploadId(id) || typeof parts !== "number" || !Number.isInteger(parts) || parts < 1 || parts > maxParts()) {
    return jsonError("Неверная загрузка", 400);
  }
  if (typeof body?.mime !== "string" || !VIDEO_MIME.has(body.mime)) return jsonError("Можно загрузить видео MP4, WebM или MOV", 400);
  try {
    const key = await joinParts(user.id, id, parts, body.mime);
    if (!key) return jsonError("Видео загрузилось не полностью — попробуйте ещё раз", 400);
    return Response.json({ key, url: fileUrl(key) });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return storageUnavailable(user, err.message);
    throw err;
  }
}
