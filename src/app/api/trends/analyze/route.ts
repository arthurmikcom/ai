import { describeAiError } from "@/lib/server/brand";
import { jsonError, requireUser } from "@/lib/server/http";
import { analyzeTrend } from "@/lib/server/maryx";
import { ownKey } from "@/lib/server/own-key";
import { charge, deniedResponse, refundCharge, reserve, settleCharge } from "@/lib/server/usage";
import type { InlineImage } from "@/lib/types";

export const maxDuration = 120;

/** A vision model reading a few frames: a few cents at most. */
const ANALYZE_HOLD_USD = 0.04;
const MAX_SHOTS = 6;
/** One frame, as the browser sends it (a JPEG up to ~768 px). */
const MAX_FRAME_BASE64 = 400_000;

/**
 * «Тренд»: MARYX looks at one frame of each scene the browser cut the video
 * into and writes what happens in each, for the user's character to repeat.
 * It counts as one chat message.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { shots?: unknown } | null;
  const raw = Array.isArray(body?.shots) ? (body.shots as Record<string, unknown>[]) : [];
  if (!raw.length || raw.length > MAX_SHOTS) return jsonError("Нужны сцены видео: от 1 до 6", 400);
  const shots: { seconds: number; frame: InlineImage }[] = [];
  for (const s of raw) {
    const seconds = Number(s?.seconds);
    const frame = s?.frame as { mime?: unknown; data?: unknown } | undefined;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120) return jsonError("Неверная длительность сцены", 400);
    if (frame?.mime !== "image/jpeg" || typeof frame.data !== "string" || !frame.data || frame.data.length > MAX_FRAME_BASE64) {
      return jsonError("Неверный кадр сцены", 400);
    }
    shots.push({ seconds, frame: { mime: "image/jpeg", data: frame.data } });
  }

  const key = await ownKey(user.id);
  const paid = await charge(user, "chat", key);
  if ("denied" in paid) return deniedResponse(user, "chat", paid.denied, { ownKey: Boolean(key) });
  let refused;
  try {
    refused = await reserve(paid, ANALYZE_HOLD_USD, { provider: "openrouter", model: "trend" });
  } catch (err) {
    await refundCharge(paid);
    throw err;
  }
  if (refused) {
    await refundCharge(paid);
    return deniedResponse(user, "chat", refused, { ownKey: Boolean(key), charge: paid });
  }
  try {
    const read = await analyzeTrend(shots, { userId: user.id, paidBy: paid.paidBy, key: paid.key });
    await settleCharge(paid, []);
    if ("refuse" in read) return jsonError(`Этот ролик MARYX повторять не будет: ${read.refuse}`, 422);
    return Response.json(read);
  } catch (err) {
    await refundCharge(paid);
    console.error("[trends] analyze", err);
    return jsonError(describeAiError(err), 502);
  }
}
