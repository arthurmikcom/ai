import { and, eq } from "drizzle-orm";
import { streamChat } from "@/lib/server/chat";
import { chatMessages, findAssistant, findChat } from "@/lib/server/chats";
import { getDb, schema } from "@/lib/server/db";
import type { StoredFile } from "@/lib/server/db/schema";
import { describeError } from "@/lib/server/errors";
import { jsonError, requireUser } from "@/lib/server/http";
import { newKey, putFile, readFileBase64 } from "@/lib/server/storage";
import { consume, limitResponse, refund } from "@/lib/server/usage";
import { parseChatSendRequest } from "@/lib/server/validate";
import type { ChatRequest, ChatStreamEvent, InlineImage } from "@/lib/types";

// Long answers from reasoning models can take several minutes.
export const maxDuration = 300;

const DEFAULT_SYSTEM =
  "Ты — Nexus AI, умный и дружелюбный ассистент. Отвечай на языке пользователя. " +
  "Используй Markdown, когда это помогает: списки, таблицы, блоки кода с указанием языка.";

function titleFrom(text: string, hasImages: boolean): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return hasImages ? "Изображение" : "Новый чат";
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/**
 * Saves the user's message, streams the model's answer as newline-delimited
 * JSON (one ChatStreamEvent per line) and stores the answer when it ends —
 * also when the user stops it or the provider fails.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const req = parseChatSendRequest(await request.json().catch(() => null));
  if (typeof req === "string") return jsonError(req, 400);

  const db = await getDb();
  let chat = await findChat(user.id, req.chatId);
  if (!chat && (!req.create || !req.message)) return jsonError("Чат не найден", 404);

  if (!(await consume(user, "chat"))) return limitResponse(user, "chat");

  if (!chat) {
    if (!req.create || !req.message) return jsonError("Чат не найден", 404); // checked above; narrows types
    const assistant = req.create.assistantId
      ? await findAssistant(user.id, req.create.assistantId)
      : undefined;
    try {
      [chat] = await db
        .insert(schema.chat)
        .values({
          id: req.chatId,
          userId: user.id,
          title: titleFrom(req.message.content, Boolean(req.message.attachments)),
          provider: req.provider,
          model: req.model,
          assistantId: assistant?.id ?? null,
        })
        .returning();
    } catch (err) {
      await refund(user.id, "chat");
      if (isUniqueViolation(err)) return jsonError("Чат с таким идентификатором уже существует", 409);
      throw err;
    }
  } else if (chat.provider !== req.provider || chat.model !== req.model) {
    await db
      .update(schema.chat)
      .set({ provider: req.provider, model: req.model })
      .where(eq(schema.chat.id, chat.id));
  }

  if (req.message) {
    const stored: StoredFile[] = [];
    for (const image of req.message.attachments ?? []) {
      const key = newKey(user.id, "attachments", image.mime);
      await putFile(key, Buffer.from(image.data, "base64"), image.mime);
      stored.push({ key, mime: image.mime });
    }
    try {
      await db.insert(schema.message).values({
        id: req.message.id,
        chatId: chat.id,
        role: "user",
        content: req.message.content,
        attachments: stored.length ? stored : null,
      });
    } catch (err) {
      await refund(user.id, "chat");
      if (isUniqueViolation(err)) return jsonError("Сообщение уже отправлено", 409);
      throw err;
    }
  } else {
    // Regenerate: replace the last answer.
    const existing = await chatMessages(chat.id);
    const last = existing[existing.length - 1];
    if (last?.role === "assistant") {
      await db
        .delete(schema.message)
        .where(and(eq(schema.message.id, last.id), eq(schema.message.chatId, chat.id)));
    }
  }

  const rows = await chatMessages(chat.id);
  if (rows[rows.length - 1]?.role !== "user") {
    await refund(user.id, "chat");
    return jsonError("Нечего отправлять: последнее сообщение не от пользователя", 400);
  }

  // Images of the new message are already in memory; older ones are re-read.
  const fresh = new Map<string, InlineImage[]>();
  if (req.message?.attachments) fresh.set(req.message.id, req.message.attachments);
  const history: ChatRequest["messages"] = await Promise.all(
    rows
      .filter((m) => m.role === "user" || (m.content && !m.error))
      .map(async (m) => {
        let attachments = fresh.get(m.id);
        if (!attachments && m.attachments?.length) {
          const loaded = await Promise.all(
            m.attachments.map(async (f) => {
              const data = await readFileBase64(f.key);
              return data ? { mime: f.mime, data } : null;
            }),
          );
          attachments = loaded.filter((a): a is InlineImage => a !== null);
        }
        return { role: m.role, content: m.content, attachments: attachments?.length ? attachments : undefined };
      }),
  );

  const assistant = chat.assistantId ? await findAssistant(user.id, chat.assistantId) : undefined;
  const chatRequest: ChatRequest = {
    provider: req.provider,
    model: req.model,
    system: assistant?.systemPrompt || DEFAULT_SYSTEM,
    deepThinking: req.deepThinking,
    messages: history,
  };
  const chatId = chat.id;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The client went away; we still save the answer below.
        }
      };

      let text = "";
      let reasoning = "";
      const notices: string[] = [];
      let error: string | undefined;

      try {
        for await (const event of streamChat(chatRequest, request.signal)) {
          if (event.type === "text") text += event.text;
          else if (event.type === "reasoning") reasoning += event.text;
          else if (event.type === "notice") notices.push(event.text);
          send(event);
        }
        send({ type: "done" });
      } catch (err) {
        if (request.signal.aborted) {
          notices.push("Генерация остановлена.");
        } else {
          console.error("[chat]", req.provider, req.model, err);
          error = describeError(err);
          send({ type: "error", message: error });
        }
      } finally {
        try {
          // A provider failure that produced nothing doesn't count toward the limit.
          if (error && !text) await refund(user.id, "chat");
          await db.insert(schema.message).values({
            id: req.answerId,
            chatId,
            role: "assistant",
            content: text,
            reasoning: reasoning || null,
            notice: notices.length ? notices.join("\n") : null,
            error: error ?? null,
            provider: req.provider,
            model: req.model,
          });
          await db.update(schema.chat).set({ updatedAt: new Date() }).where(eq(schema.chat.id, chatId));
        } catch (err) {
          console.error("[chat] failed to save the answer", err);
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
