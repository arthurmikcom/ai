import { and, count, eq, gt } from "drizzle-orm";
import { BROWSER_MODELS } from "@/lib/catalog";
import { chatMessages, findAssistant, findChat, storedKeys, titleFrom } from "@/lib/server/chats";
import { getDb, schema } from "@/lib/server/db";
import { isValidId, jsonError, requireUser } from "@/lib/server/http";
import { deleteFiles } from "@/lib/server/storage";

/** Answers from browser models a user may save per day (they cost us only storage). */
const DAILY_CAP = 1000;
const MAX_TEXT = 100_000;
const BROWSER_IDS = new Set(BROWSER_MODELS.map((m) => m.id));

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

/**
 * Saves a chat turn answered by a model in the visitor's browser (no model runs
 * here). Called twice per turn: first with the user's `message` (or `replyTo`
 * when regenerating), then with the finished `answer`.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isValidId(body.chatId)) return jsonError("Неверный идентификатор", 400);
  const provider = body.provider;
  if (provider !== "browser" && provider !== "maryx") return jsonError("Неизвестный провайдер", 400);
  const model = text(body.model, 200);
  if (!model || (provider === "browser" ? !BROWSER_IDS.has(model) : model !== "maryx")) {
    return jsonError("Неизвестная модель", 400);
  }

  if (body.message === undefined && body.replyTo === undefined && body.answer === undefined) {
    return jsonError("Нечего сохранять", 400);
  }

  const db = await getDb();
  let chat = await findChat(user.id, body.chatId);

  // ----- The question (a new message, or the one a regenerated answer replies to) -----
  const message = body.message as Record<string, unknown> | undefined;
  if (message !== undefined) {
    const content = text(message?.content, MAX_TEXT);
    if (!message || !isValidId(message.id) || content === null) return jsonError("Неверный формат сообщения", 400);
    if (!content.trim()) return jsonError("Пустое сообщение", 400);
    if (!chat) {
      const create = body.create as { assistantId?: unknown } | undefined;
      if (!create || typeof create !== "object") return jsonError("Чат не найден", 404);
      const assistant = isValidId(create.assistantId) ? await findAssistant(user.id, create.assistantId) : undefined;
      try {
        [chat] = await db
          .insert(schema.chat)
          .values({ id: body.chatId, userId: user.id, title: titleFrom(content), provider, model, assistantId: assistant?.id ?? null })
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) return jsonError("Чат с таким идентификатором уже существует", 409);
        throw err;
      }
    } else if (chat.provider !== provider || chat.model !== model) {
      await db.update(schema.chat).set({ provider, model }).where(eq(schema.chat.id, chat.id));
    }
    try {
      await db.insert(schema.message).values({ id: message.id, chatId: chat.id, role: "user", content });
    } catch (err) {
      if (isUniqueViolation(err)) return jsonError("Сообщение уже отправлено", 409);
      throw err;
    }
  } else if (body.replyTo !== undefined) {
    if (!chat) return jsonError("Чат не найден", 404);
    if (!isValidId(body.replyTo)) return jsonError("Неверный идентификатор", 400);
    const rows = await chatMessages(chat.id);
    if (rows.findLast((m) => m.role === "user")?.id !== body.replyTo) {
      return jsonError("Это сообщение не сохранилось — отправьте его ещё раз.", 409);
    }
    const last = rows[rows.length - 1];
    if (last?.role === "assistant") {
      await db.delete(schema.message).where(and(eq(schema.message.id, last.id), eq(schema.message.chatId, chat.id)));
      await deleteFiles(storedKeys(last.attachments ?? [])).catch(() => {});
    }
  }

  // ----- The answer -----
  const answer = body.answer as Record<string, unknown> | undefined;
  if (answer !== undefined) {
    if (!chat) return jsonError("Чат не найден", 404);
    const content = text(answer?.content ?? "", MAX_TEXT);
    const reasoning = text(answer?.reasoning ?? "", MAX_TEXT);
    const notice = text(answer?.notice ?? "", 1000);
    const error = text(answer?.error ?? "", 1000);
    const answeredBy = text(answer?.model, 200);
    if (!answer || !isValidId(answer.id) || content === null || reasoning === null || notice === null || error === null) {
      return jsonError("Неверный формат ответа", 400);
    }
    if (!answeredBy || !BROWSER_IDS.has(answeredBy)) return jsonError("Неизвестная модель", 400);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.message)
      .innerJoin(schema.chat, eq(schema.chat.id, schema.message.chatId))
      .where(and(eq(schema.chat.userId, user.id), eq(schema.message.provider, "browser"), gt(schema.message.createdAt, since)));
    if (n >= DAILY_CAP) return jsonError("Слишком много сообщений за сутки — попробуйте завтра.", 429);

    const rows = await chatMessages(chat.id);
    if (rows[rows.length - 1]?.role !== "user") return jsonError("Ответ не к чему привязать: отправьте вопрос ещё раз.", 409);
    try {
      await db.insert(schema.message).values({
        id: answer.id,
        chatId: chat.id,
        role: "assistant",
        content,
        reasoning: reasoning || null,
        notice: notice || null,
        error: error || null,
        provider: "browser",
        model: answeredBy,
        via: provider === "maryx" ? "maryx" : null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) return jsonError("Ответ уже сохранён", 409);
      throw err;
    }
  }

  if (!chat) return jsonError("Нечего сохранять", 400);
  await db.update(schema.chat).set({ updatedAt: new Date() }).where(eq(schema.chat.id, chat.id));
  return Response.json({ ok: true });
}
