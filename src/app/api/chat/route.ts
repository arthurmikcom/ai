import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { streamChat } from "@/lib/server/chat";
import { canDrawInChat, chatImageModel, generateChatImage } from "@/lib/server/chat/image";
import { chatMessages, findAssistant, findChat, storedKeys } from "@/lib/server/chats";
import { getDb, schema } from "@/lib/server/db";
import type { StoredFile } from "@/lib/server/db/schema";
import { describeError } from "@/lib/server/errors";
import { jsonError, requireUser } from "@/lib/server/http";
import {
  DocumentError,
  DocumentLimitError,
  extractDocumentText,
  isDocumentMime,
  withDocuments,
} from "@/lib/server/documents";
import { deleteFiles, fileUrl, newKey, putFile, readFileBase64 } from "@/lib/server/storage";
import {
  listFacts,
  memoryEnabled,
  mightHaveFacts,
  maryxSystem,
  planRoute,
  rememberFrom,
  wantsImage,
  type MaryxPlan,
} from "@/lib/server/maryx";
import { consume, limitResponse, refund } from "@/lib/server/usage";
import { parseChatSendRequest } from "@/lib/server/validate";
import type { ChatRequest, ChatStreamEvent, InlineFile, InlineImage, Source, UsageKind } from "@/lib/types";

// Long answers from reasoning models can take several minutes.
export const maxDuration = 300;

/**
 * Characters of document text sent with one request (~40–50k tokens). The
 * newest documents get it first; older ones are shortened or left out.
 */
const DOCUMENT_BUDGET = 150_000;

const DEFAULT_SYSTEM =
  "Ты — MARYX Ai, умный и дружелюбный ассистент. Отвечай на языке пользователя. " +
  "Используй Markdown, когда это помогает: списки, таблицы, блоки кода с указанием языка.";

function titleFrom(text: string, files: InlineFile[] = []): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return files.find((f) => f.name && isDocumentMime(f.mime))?.name ?? (files.length ? "Изображение" : "Новый чат");
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

  // MARYX draws by itself when asked to ("нарисуй…", no files attached) and an image model is set up.
  const maryx = req.provider === "maryx";
  const autoDraw =
    maryx &&
    !req.image &&
    req.message !== undefined &&
    !req.message.attachments?.length &&
    wantsImage(req.message.content) &&
    (await canDrawInChat());
  let draw = req.image || autoDraw;
  // A picture drawn in the chat counts toward the image limit, not messages.
  let kind: UsageKind = draw ? "image" : "chat";
  if (!(await consume(user, kind))) {
    // MARYX chose to draw on its own: with no pictures left today, answer in words.
    if (!autoDraw || !(await consume(user, "chat"))) return limitResponse(user, autoDraw ? "chat" : kind);
    draw = false;
    kind = "chat";
  }

  const created = !chat;
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
          title: titleFrom(req.message.content, req.message.attachments),
          provider: req.provider,
          model: req.model,
          assistantId: assistant?.id ?? null,
        })
        .returning();
    } catch (err) {
      await refund(user.id, kind);
      if (isUniqueViolation(err)) return jsonError("Чат с таким идентификатором уже существует", 409);
      throw err;
    }
  } else if (chat.provider !== req.provider || chat.model !== req.model) {
    await db
      .update(schema.chat)
      .set({ provider: req.provider, model: req.model })
      .where(eq(schema.chat.id, chat.id));
  }

  // Text of documents attached to the new message (by text key), to skip re-reading it.
  const documentTexts = new Map<string, string>();
  if (req.message) {
    const stored: StoredFile[] = [];
    try {
      for (const file of req.message.attachments ?? []) {
        const bytes = Buffer.from(file.data, "base64");
        const key = newKey(user.id, "attachments", file.mime);
        if (isDocumentMime(file.mime)) {
          // The text is pulled out once and kept next to the file for later turns.
          const name = file.name || "документ";
          const text = await extractDocumentText(bytes, file.mime, name);
          const textKey = newKey(user.id, "attachments", "text/plain");
          await putFile(key, bytes, file.mime);
          stored.push({ key, mime: file.mime, name });
          await putFile(textKey, Buffer.from(text, "utf8"), "text/plain");
          Object.assign(stored[stored.length - 1], { textKey, chars: text.length });
          documentTexts.set(textKey, text);
        } else {
          await putFile(key, bytes, file.mime);
          stored.push({ key, mime: file.mime, name: file.name });
        }
      }
    } catch (err) {
      await deleteFiles(storedKeys(stored)).catch(() => {});
      // A file that trips the safety limits keeps its charge, so it can't be retried for free.
      if (!(err instanceof DocumentLimitError)) await refund(user.id, kind);
      // Don't leave an empty chat behind when its first message was refused.
      if (created) await db.delete(schema.chat).where(and(eq(schema.chat.id, chat.id), eq(schema.chat.userId, user.id)));
      if (err instanceof DocumentError) return jsonError(err.message, 400);
      throw err;
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
      await refund(user.id, kind);
      if (isUniqueViolation(err)) return jsonError("Сообщение уже отправлено", 409);
      throw err;
    }
  } else {
    // Regenerate: replace the last answer.
    const existing = await chatMessages(chat.id);
    // The browser names the message it wants answered; if that one never reached the
    // server (e.g. it was refused), don't throw away the previous answer instead.
    const lastUser = existing.findLast((m) => m.role === "user");
    if (req.replyTo && lastUser?.id !== req.replyTo) {
      await refund(user.id, kind);
      return jsonError("Это сообщение не сохранилось — отправьте его ещё раз.", 409);
    }
    const last = existing[existing.length - 1];
    if (last?.role === "assistant") {
      await db
        .delete(schema.message)
        .where(and(eq(schema.message.id, last.id), eq(schema.message.chatId, chat.id)));
      // A replaced drawing takes its picture with it.
      await deleteFiles(storedKeys(last.attachments ?? [])).catch(() => {});
    }
  }

  const rows = await chatMessages(chat.id);
  if (rows[rows.length - 1]?.role !== "user") {
    await refund(user.id, kind);
    return jsonError("Нечего отправлять: последнее сообщение не от пользователя", 400);
  }

  if (draw) {
    return drawInChat(request, user.id, chat.id, req.answerId, rows[rows.length - 1].content, maryx ? "maryx" : undefined);
  }

  // Images of the new message are already in memory; older ones are re-read.
  const fresh = new Map<string, InlineImage[]>();
  if (req.message?.attachments) {
    fresh.set(req.message.id, req.message.attachments.filter((a) => a.mime.startsWith("image/")));
  }
  const kept = rows.filter((m) => m.role === "user" || (m.content && !m.error));
  // Document text budget goes to the newest documents first; older ones past it are
  // left out (not even read), so a chat full of long files stays cheap per turn.
  const allowance = new Map<string, number>();
  let budgetLeft = DOCUMENT_BUDGET;
  for (const m of [...kept].reverse()) {
    if (m.role !== "user") continue;
    for (const f of m.attachments ?? []) {
      if (!f.textKey) continue;
      const size = f.chars ?? documentTexts.get(f.textKey)?.length ?? DOCUMENT_BUDGET;
      const share = Math.min(size, budgetLeft);
      allowance.set(f.textKey, share);
      budgetLeft -= share;
    }
  }
  const loaded = await Promise.all(
    kept.map(async (m) => {
      // Pictures drawn by the assistant stay out: models only read the user's files.
      const files = m.role === "user" ? (m.attachments ?? []) : [];
      let images = fresh.get(m.id);
      if (!images) {
        const read = await Promise.all(
          files
            .filter((f) => f.mime.startsWith("image/"))
            .map(async (f) => {
              const data = await readFileBase64(f.key);
              return data ? { mime: f.mime, data } : null;
            }),
        );
        images = read.filter((a): a is InlineImage => a !== null);
      }
      const docs = await Promise.all(
        files
          .filter((f) => f.textKey)
          .map(async (f) => {
            const max = allowance.get(f.textKey!) ?? 0;
            // Only documents that fit the budget are read at all.
            const text =
              max > 0
                ? (documentTexts.get(f.textKey!) ??
                  Buffer.from((await readFileBase64(f.textKey!)) ?? "", "base64").toString("utf8"))
                : "";
            return { name: f.name || "документ", text, max };
          }),
      );
      return { m, images, docs };
    }),
  );
  const history: ChatRequest["messages"] = loaded.map(({ m, images, docs }) => ({
    role: m.role,
    content: docs.length ? withDocuments(m.content, docs) : m.content,
    attachments: images.length ? images : undefined,
  }));

  const assistant = chat.assistantId ? await findAssistant(user.id, chat.assistantId) : undefined;

  // MARYX: pick the real model for this message, then speak as MARYX with its memory.
  let route: MaryxPlan | undefined;
  let system = assistant?.systemPrompt || DEFAULT_SYSTEM;
  let messages = mergeTurns(history);
  // Stored facts go into every MARYX answer (regenerations too); new ones are learned from new messages.
  const memoryOn = maryx && (await memoryEnabled(user.id));
  if (maryx) {
    const last = loaded[loaded.length - 1];
    try {
      route = await planRoute({
        text: last.m.content,
        hasImages: last.images.length > 0,
        hasDocuments: last.docs.length > 0,
        deepThinking: req.deepThinking ?? false,
        webSearch: req.webSearch ?? false,
      });
    } catch (err) {
      await refund(user.id, kind);
      return jsonError(describeError(err), 503);
    }
    const facts = memoryOn ? (await listFacts(user.id)).map((f) => f.text) : [];
    system = maryxSystem(route.model, facts, assistant?.systemPrompt);
    // Older pictures can't go to a model that doesn't see images.
    if (!route.model.vision) {
      messages = messages.map((m) =>
        m.attachments ? { ...m, attachments: undefined, content: `${m.content}\n[К сообщению было приложено изображение]` } : m,
      );
    }
  }
  const provider = route?.model.provider ?? req.provider;
  const model = route?.model.id ?? req.model;
  const chatRequest: ChatRequest = {
    provider,
    model,
    system,
    deepThinking: req.deepThinking,
    webSearch: route ? route.webSearch : req.webSearch,
    messages,
  };
  const chatId = chat.id;

  // After the answer is sent: let MARYX note lasting facts from this message —
  // only when the answer actually came through (a failed one is refunded).
  const userText = req.message?.content ?? "";
  let answered = false;
  if (memoryOn && req.message && mightHaveFacts(userText)) {
    after(() =>
      answered ? rememberFrom(user.id, userText).catch((err) => console.error("[maryx] memory update failed", err)) : undefined,
    );
  }

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
      const sources: Source[] = [];
      let error: string | undefined;

      try {
        if (route) send({ type: "route", provider, model, search: route.webSearch || undefined });
        for await (const event of streamChat(chatRequest, request.signal)) {
          if (event.type === "text") text += event.text;
          else if (event.type === "reasoning") reasoning += event.text;
          else if (event.type === "notice") notices.push(event.text);
          else if (event.type === "source") sources.push({ url: event.url, title: event.title });
          send(event);
        }
        send({ type: "done" });
      } catch (err) {
        if (request.signal.aborted) {
          notices.push("Генерация остановлена.");
        } else {
          console.error("[chat]", provider, model, err);
          error = describeError(err);
          send({ type: "error", message: error });
        }
      } finally {
        try {
          // A provider failure that produced nothing doesn't count toward the limit.
          if (error && !text) await refund(user.id, kind);
          answered = !error && text.length > 0;
          await db.insert(schema.message).values({
            id: req.answerId,
            chatId,
            role: "assistant",
            content: text,
            reasoning: reasoning || null,
            notice: notices.length ? notices.join("\n") : null,
            sources: sources.length ? sources.slice(0, 20) : null,
            error: error ?? null,
            provider,
            model,
            via: route ? "maryx" : null,
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

  return ndjson(body);
}

/**
 * A failed answer leaves two user messages in a row. Some providers (Gemini)
 * insist on alternating turns, so consecutive messages of one role are joined.
 */
function mergeTurns(messages: ChatRequest["messages"]): ChatRequest["messages"] {
  const merged: ChatRequest["messages"] = [];
  for (const m of messages) {
    const prev = merged[merged.length - 1];
    if (prev?.role === m.role) {
      prev.content = [prev.content, m.content].filter(Boolean).join("\n\n");
      if (m.attachments) prev.attachments = [...(prev.attachments ?? []), ...m.attachments];
    } else {
      merged.push({ ...m });
    }
  }
  return merged;
}

function ndjson(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Image mode: draws a picture from the last user message and stores it as the
 * answer. Streams the same NDJSON events as a text answer, plus "image".
 */
function drawInChat(
  request: Request,
  userId: string,
  chatId: string,
  answerId: string,
  prompt: string,
  via?: "maryx",
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The client went away; the result is still saved below.
        }
      };
      const db = await getDb();
      let files: StoredFile[] = [];
      let model: { provider: ChatRequest["provider"]; id: string } | undefined;
      let text = "";
      let error: string | undefined;
      let notice: string | undefined;
      try {
        const picked = await chatImageModel();
        model = picked;
        if (via) send({ type: "route", provider: picked.provider, model: picked.id, image: true });
        files = await generateChatImage(userId, prompt, picked, request.signal);
        for (const f of files) {
          send({ type: "image", url: fileUrl(f.key), mime: f.mime, provider: picked.provider, model: picked.id });
        }
        text = "Готово! Вот что получилось.";
        send({ type: "text", text });
        send({ type: "done" });
      } catch (err) {
        if (request.signal.aborted) {
          notice = "Генерация остановлена.";
        } else {
          console.error("[chat:image]", model?.provider, model?.id, err);
          error = describeError(err);
          send({ type: "error", message: error });
        }
      } finally {
        try {
          if (!files.length) await refund(userId, "image");
          await db.insert(schema.message).values({
            id: answerId,
            chatId,
            role: "assistant",
            content: text,
            attachments: files.length ? files : null,
            notice: notice ?? null,
            error: error ?? null,
            provider: model?.provider ?? null,
            model: model?.id ?? null,
            via: via ?? null,
          });
          await db.update(schema.chat).set({ updatedAt: new Date() }).where(eq(schema.chat.id, chatId));
        } catch (err) {
          console.error("[chat:image] failed to save the answer", err);
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return ndjson(body);
}
