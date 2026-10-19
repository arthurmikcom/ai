import { MAX_VIDEO_MB, sizeText } from "@/lib/limits";
import { jsonError, requireUser } from "@/lib/server/http";
import { deleteFiles } from "@/lib/server/storage";
import { isOwnVideoKey, maxVideoBytes, UPLOAD_PART_BYTES, VIDEO_MIME } from "@/lib/server/uploads";
import { countUpload, dailyUploadMb } from "@/lib/server/usage";

/** Starts a whole video's upload: its id and the part size to send it in. */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { mime?: unknown; size?: unknown } | null;
  if (typeof body?.mime !== "string" || !VIDEO_MIME.has(body.mime)) return jsonError("Можно загрузить видео MP4, WebM или MOV", 400);
  if (typeof body.size !== "number" || body.size <= 0) return jsonError("Пустой файл", 400);
  if (body.size > maxVideoBytes()) return jsonError(`Видео слишком большое: до ${sizeText(MAX_VIDEO_MB)}`, 413);
  if (!(await countUpload(user, body.size))) {
    return jsonError(`На сегодня можно загрузить видео всего на ${sizeText(dailyUploadMb())}, и это видео уже не помещается. Попробуйте завтра или видео поменьше.`, 429);
  }
  return Response.json({ id: crypto.randomUUID(), part: UPLOAD_PART_BYTES });
}

/** An uploaded video taken out of the message before sending: it isn't kept. */
export async function DELETE(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== "string" || !isOwnVideoKey(user.id, body.key)) return jsonError("Неверное видео", 400);
  await deleteFiles([body.key]);
  return Response.json({ ok: true });
}
