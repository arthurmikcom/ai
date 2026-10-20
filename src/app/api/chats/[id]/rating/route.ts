import { isRatingReason } from "@/lib/ratings";
import { rateMessage } from "@/lib/server/chats";
import { jsonError, requireUser } from "@/lib/server/http";

type Context = { params: Promise<{ id: string }> };

/** 👍/👎 on an answer: { messageId, rating: 1 | -1 | 0, reason? } (0 takes the verdict back). */
export async function PUT(request: Request, { params }: Context) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { messageId?: unknown; rating?: unknown; reason?: unknown } | null;
  const rating = body?.rating;
  if (typeof body?.messageId !== "string" || (rating !== 1 && rating !== -1 && rating !== 0)) return jsonError("Неверная оценка", 400);
  if (body.reason !== undefined && !isRatingReason(body.reason)) return jsonError("Неверная причина", 400);
  return (await rateMessage(user.id, (await params).id, body.messageId, rating, body.reason))
    ? Response.json({ ok: true })
    : jsonError("Ответ не найден", 404);
}
