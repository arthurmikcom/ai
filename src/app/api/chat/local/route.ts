import { and, eq, sql } from "drizzle-orm";
import { BROWSER_MODELS } from "@/lib/catalog";
import { isAdmin, type SessionUser } from "@/lib/server/auth";
import { chatMessages, findAssistant, findChat, storedKeys, titleFrom } from "@/lib/server/chats";
import { getDb, schema } from "@/lib/server/db";
import { isValidId, jsonError, requireUser } from "@/lib/server/http";
import { deleteFiles } from "@/lib/server/storage";
import type { UsageKind } from "@/lib/types";

/** Questions a user may put to browser models per day (they cost us only storage). */
const DAILY_CAP = 300;
/** A browser model's context is 4096 tokens, so longer questions are cut anyway. */
const MAX_QUESTION = 20_000;
/** Its answer is at most 2048 tokens. */
const MAX_ANSWER = 30_000;
const BROWSER_IDS = new Set(BROWSER_MODELS.map((m) => m.id));

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

/** Counts one question against today's cap, atomically; false when it's reached. */
async function countQuestion(user: SessionUser): Promise<boolean> {
  if (isAdmin(user)) return true;
  const db = await getDb();
  const kind = "local" as UsageKind; // kept out of the plans and usage screens
  const rows = await db
    .insert(schema.usage)
    .values({ userId: user.id, day: new Date().toISOString().slice(0, 10), kind, count: 1 })
    .onConflictDoUpdate({
      target: [schema.usage.userId, schema.usage.day, schema.usage.kind],
      set: { count: sql`${schema.usage.count} + 1` },
      setWhere: sql`${schema.usage.count} < ${DAILY_CAP}`,
    })
    .returning({ count: schema.usage.count });
  return rows.length > 0;
}

/**
 * Saves a chat turn answered by a model in the visitor's browser (no model runs
 * here). Called twice per turn: first with the user's `message` (or, when
 * regenerating, `replyTo` to check the question is still the last one), then
 * with the finished `answer`, which names its question and may `replace` the
 * previous answer to it.
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

  // ----- The question -----
  const message = body.message as Record<string, unknown> | undefined;
  if (message !== undefined) {
    const content = text(message?.content, MAX_QUESTION);
    if (!message || !isValidId(message.id)) return jsonError("Неверный формат сообщения", 400);
    if (content === null) return jsonError("Сообщение слишком длинное для модели в браузере", 400);
    if (!content.trim()) return jsonError("Пустое сообщение", 400);
    if (chat) {
      // A retry of a question that did reach us (e.g. its response was lost): fine.
      const rows = await chatMessages(chat.id);
      if (rows.some((m) => m.id === message.id && m.role === "user" && m.content === content)) {
        return Response.json({ ok: true });
      }
    }
    if (!(await countQuestion(user))) return jsonError("На сегодня лимит вопросов модели в браузере исчерпан — попробуйте завтра.", 429);
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
  } else if (body.replyTo !== undefined && body.answer === undefined) {
    // Regenerate, before the model runs: only checks (the old answer stays until the new one is saved).
    if (!chat) return jsonError("Чат не найден", 404);
    if (!isValidId(body.replyTo)) return jsonError("Неверный идентификатор", 400);
    const rows = await chatMessages(chat.id);
    if (rows.findLast((m) => m.role === "user")?.id !== body.replyTo) {
      return jsonError("Это сообщение не сохранилось — отправьте его ещё раз.", 409);
    }
    if (!(await countQuestion(user))) return jsonError("На сегодня лимит вопросов модели в браузере исчерпан — попробуйте завтра.", 429);
    if (chat.provider !== provider || chat.model !== model) {
      await db.update(schema.chat).set({ provider, model }).where(eq(schema.chat.id, chat.id));
    }
  }

  // ----- The answer -----
  const answer = body.answer as Record<string, unknown> | undefined;
  if (answer !== undefined) {
    if (!chat) return jsonError("Чат не найден", 404);
    const content = text(answer?.content ?? "", MAX_ANSWER);
    const reasoning = text(answer?.reasoning ?? "", MAX_ANSWER);
    const notice = text(answer?.notice ?? "", 1000);
    const error = text(answer?.error ?? "", 1000);
    const answeredBy = text(answer?.model, 200);
    if (!answer || !isValidId(answer.id) || !isValidId(answer.replyTo)) return jsonError("Неверный формат ответа", 400);
    if (content === null || reasoning === null || notice === null || error === null) return jsonError("Ответ слишком длинный", 400);
    if (!answeredBy || !BROWSER_IDS.has(answeredBy)) return jsonError("Неизвестная модель", 400);
    const values = {
      content,
      reasoning: reasoning || null,
      notice: notice || null,
      error: error || null,
      provider: "browser" as const,
      model: answeredBy,
      via: provider === "maryx" ? ("maryx" as const) : null,
    };

    const rows = await chatMessages(chat.id);
    const last = rows[rows.length - 1];
    // The same answer again (saved on tab close, then finished): keep the fuller text.
    if (last?.role === "assistant" && last.id === answer.id) {
      await db.update(schema.message).set(values).where(and(eq(schema.message.id, last.id), eq(schema.message.chatId, chat.id)));
    } else {
      if (rows.findLast((m) => m.role === "user")?.id !== answer.replyTo) {
        return jsonError("Пока модель отвечала, в чат написали ещё — ответ не сохранён.", 409);
      }
      if (last?.role === "assistant") {
        if (answer.replace !== true) return jsonError("На этот вопрос уже есть ответ.", 409);
        await db.delete(schema.message).where(and(eq(schema.message.id, last.id), eq(schema.message.chatId, chat.id)));
        await deleteFiles(storedKeys(last.attachments ?? [])).catch(() => {});
      }
      try {
        await db.insert(schema.message).values({ id: answer.id, chatId: chat.id, role: "assistant", ...values });
      } catch (err) {
        if (isUniqueViolation(err)) return jsonError("Ответ уже сохранён", 409);
        throw err;
      }
    }
  }

  if (!chat) return jsonError("Нечего сохранять", 400);
  await db.update(schema.chat).set({ updatedAt: new Date() }).where(eq(schema.chat.id, chat.id));
  return Response.json({ ok: true });
}
