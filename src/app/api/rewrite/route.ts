import { describeAiError } from "@/lib/server/brand";
import { jsonError, requireUser } from "@/lib/server/http";
import { REWRITE_TASKS, rewriteText, type RewriteTask } from "@/lib/server/maryx";
import { ownKey } from "@/lib/server/own-key";
import { charge, deniedResponse, refundCharge, reserve, settleCharge } from "@/lib/server/usage";

export const maxDuration = 120;

/** What one edit may cost at most (a strong model, a long text), held until it's done. */
const REWRITE_HOLD_USD = 0.04;
/** The text to rewrite at once: a long article; a longer document is edited part by part. */
const MAX_TEXT = 15_000;
const MAX_DOCUMENT = 60_000;

/**
 * «Холст для текстов»: MARYX rewrites a document (or the selected part of it)
 * as asked — better, shorter, without mistakes, in the user's own words. It
 * counts as one chat message (its cost is recorded like a background job).
 */
export async function POST(request: Request) {
  const user = await requireUser(request, { guest: true });
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => null)) as
    | { text?: unknown; task?: unknown; instruction?: unknown; document?: unknown }
    | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const document = typeof body?.document === "string" && body.document.trim() ? body.document : undefined;
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  const task = body?.task === "custom" ? instruction : REWRITE_TASKS[body?.task as RewriteTask];
  if (!text.trim()) return jsonError("Нечего переписывать", 400);
  if (!task || typeof task !== "string") return jsonError(body?.task === "custom" ? "Напишите, что изменить" : "Неизвестное действие", 400);
  if (instruction.length > 1000) return jsonError("Просьба слишком длинная: до 1000 символов", 400);
  if (text.length > MAX_TEXT) return jsonError("Текст слишком длинный — выделите часть до 15 000 символов", 400);
  if (document && document.length > MAX_DOCUMENT) return jsonError("Документ слишком длинный: до 60 000 символов", 400);

  const key = await ownKey(user.id);
  const paid = await charge(user, "chat", key);
  if ("denied" in paid) return deniedResponse(user, "chat", paid.denied, { ownKey: Boolean(key) });
  let refused;
  try {
    refused = await reserve(paid, REWRITE_HOLD_USD, { provider: "openrouter", model: "rewrite" });
  } catch (err) {
    await refundCharge(paid);
    throw err;
  }
  if (refused) {
    await refundCharge(paid);
    return deniedResponse(user, "chat", refused, { ownKey: Boolean(key), charge: paid });
  }
  try {
    const rewritten = await rewriteText({ text, task, document }, { userId: user.id, paidBy: paid.paidBy, key: paid.key });
    if (!rewritten) throw new Error("Не получилось переписать текст. Попробуйте ещё раз.");
    // The model's cost is already recorded (as a background job); this settles the message.
    await settleCharge(paid, []);
    return Response.json({ text: rewritten });
  } catch (err) {
    await refundCharge(paid);
    console.error("[rewrite]", err);
    return jsonError(describeAiError(err), 502);
  }
}
