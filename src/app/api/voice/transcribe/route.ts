import { describeError } from "@/lib/server/errors";
import { jsonError, requireUser } from "@/lib/server/http";
import { consume, limitResponse, refund } from "@/lib/server/usage";
import { clipSeconds, transcribe } from "@/lib/server/voice";

export const maxDuration = 60;

/** The browser records at 32 kbps and stops at two minutes (about 0.5 MB). */
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
/** Transcription is billed per minute, so the length is checked, not just the size. */
const MAX_SECONDS = 130;
/** A clip whose length can't be read must be small enough to be short at any bitrate we expect. */
const MAX_UNKNOWN_LENGTH_BYTES = 768 * 1024;

/** Dictation: an audio clip (multipart field "audio") in, its text out. */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return jsonError("Нет записи", 400);
  if (audio.size > MAX_AUDIO_BYTES) return jsonError("Запись слишком длинная: до 2 минут", 413);
  const mime = audio.type.split(";")[0].trim();
  if (!/^(audio|video)\/(webm|mp4|ogg|mpeg|wav|x-wav|aac|x-m4a)$/.test(mime)) {
    return jsonError("Неподдерживаемый формат записи", 400);
  }

  const bytes = Buffer.from(await audio.arrayBuffer());
  const seconds = await clipSeconds(bytes, mime);
  if (seconds === null ? bytes.length > MAX_UNKNOWN_LENGTH_BYTES : seconds > MAX_SECONDS) {
    return jsonError("Запись слишком длинная: до 2 минут", 413);
  }

  if (!(await consume(user, "voice"))) return limitResponse(user, "voice");
  try {
    const text = await transcribe(bytes, mime);
    // The provider has already processed (and billed) the clip, so it still counts.
    if (!text) return jsonError("Не удалось разобрать речь. Попробуйте говорить громче или ближе к микрофону.", 422);
    return Response.json({ text });
  } catch (err) {
    await refund(user.id, "voice");
    console.error("[voice]", err);
    return jsonError(describeError(err), 502);
  }
}
