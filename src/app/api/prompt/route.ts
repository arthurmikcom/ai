import { describeAiError } from "@/lib/server/brand";
import { jsonError, requireUser } from "@/lib/server/http";
import { enhancePrompt } from "@/lib/server/maryx";
import { ownKey } from "@/lib/server/own-key";
import { charge, deniedResponse, refundCharge, reserve, settleCharge } from "@/lib/server/usage";

export const maxDuration = 60;

/** What one rewrite may cost at most (a fast model, a short text), held until it's done. */
const ENHANCE_HOLD_USD = 0.003;

/**
 * "✨ Улучшить": a short idea in, a detailed prompt for the image or video model
 * out. It counts as one chat message (its cost is recorded like a background job).
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => null)) as { kind?: unknown; prompt?: unknown; photo?: unknown } | null;
  const kind = body?.kind;
  const idea = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (kind !== "image" && kind !== "video") return jsonError("Неизвестный тип", 400);
  if (!idea) return jsonError("Напишите идею — MARYX её улучшит", 400);
  if (idea.length > 2000) return jsonError("Описание слишком длинное: до 2000 символов", 400);

  const key = await ownKey(user.id);
  const paid = await charge(user, "chat", key);
  if ("denied" in paid) return deniedResponse(user, "chat", paid.denied, { ownKey: Boolean(key) });
  let refused;
  try {
    refused = await reserve(paid, ENHANCE_HOLD_USD, { provider: "openrouter", model: "prompt" });
  } catch (err) {
    await refundCharge(paid);
    throw err;
  }
  if (refused) {
    await refundCharge(paid);
    return deniedResponse(user, "chat", refused, { ownKey: Boolean(key), charge: paid });
  }
  try {
    const prompt = await enhancePrompt(kind, idea, body?.photo === true, { userId: user.id, paidBy: paid.paidBy, key: paid.key });
    if (!prompt) throw new Error("Не получилось улучшить описание. Попробуйте ещё раз.");
    // The model's cost is already recorded (as a background job); this settles the message.
    await settleCharge(paid, []);
    return Response.json({ prompt });
  } catch (err) {
    await refundCharge(paid);
    console.error("[prompt]", err);
    return jsonError(describeAiError(err), 502);
  }
}
