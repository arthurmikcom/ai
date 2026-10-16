import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { streamChat } from "@/lib/server/chat";
import { canDrawInChat, chatImageModel, generateChatImage } from "@/lib/server/chat/image";
import { chatMessages, findAssistant, findChat, storedKeys, titleFrom } from "@/lib/server/chats";
import { getDb, schema } from "@/lib/server/db";
import type { StoredFile } from "@/lib/server/db/schema";
import { describeError, statusOf } from "@/lib/server/errors";
import { loadOpenRouterChatModels } from "@/lib/server/models";
import { jsonError, requireUser } from "@/lib/server/http";
import {
  DocumentError,
  DocumentLimitError,
  extractDocumentText,
  isDocumentMime,
  shorten,
  withDocuments,
} from "@/lib/server/documents";
import { deleteFiles, fileUrl, newKey, putFile, readFileBase64 } from "@/lib/server/storage";
import {
  ANSWER_STYLE,
  instructionLines,
  listFacts,
  mightHaveFacts,
  maryxSystem,
  planRoute,
  rememberFrom,
  suggestFollowUps,
  suggestTitle,
  userPrefs,
  wantsImage,
  type MaryxPlan,
} from "@/lib/server/maryx";
import { consume, limitResponse, refund } from "@/lib/server/usage";
import { parseChatSendRequest } from "@/lib/server/validate";
import type { ChatRequest, ChatStreamEvent, InlineImage, ModelInfo, Source, UsageKind } from "@/lib/types";

// Long answers from reasoning models can take several minutes.
export const maxDuration = 300;

/**
 * Characters of document text sent with one request (~40–50k tokens). The
 * newest documents get it first; older ones are shortened or left out.
 */
const DOCUMENT_BUDGET = 150_000;

/**
 * Characters of conversation text sent with one request (~20k tokens). In a
 * longer chat the oldest turns are left out, so every turn stays fast and cheap.
 */
const HISTORY_BUDGET = 60_000;

/** Pictures sent again from earlier turns; older ones are mentioned in words. */
const HISTORY_IMAGES = 4;

/** MARYX tries a fallback model only this soon after starting (maxDuration is 300 s). */
const FALLBACK_WINDOW_MS = 90_000;

const DEFAULT_SYSTEM = `Ты — MARYX Ai, умный и дружелюбный ассистент.\n${ANSWER_STYLE}`;

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

  // A long chat sends only its newest turns that fit the budget, opening with the user.
  // The latest exchange (the question before the last answer, and that answer) always
  // goes: a turn of it that doesn't fit is shortened, so a follow-up keeps its context.
  const lastAnswer = kept.findLastIndex((m) => m.role === "assistant");
  let floor = lastAnswer < 0 ? kept.length - 1 : lastAnswer;
  while (floor > 0 && kept[floor].role !== "user") floor--;
  let first = kept.length - 1;
  let used = kept[first].content.length;
  while (first > 0) {
    const turn = kept[first - 1];
    if (used + turn.content.length > HISTORY_BUDGET) {
      if (first - 1 < floor) break;
      const room = Math.max(4000, HISTORY_BUDGET - used);
      kept[first - 1] = { ...turn, content: shorten(turn.content, room) };
    }
    first--;
    used += kept[first].content.length;
  }
  while (kept[first].role !== "user") first++;
  const recent = kept.slice(first);
  // Documents from the turns left out still come along, with the first turn that's sent.
  const carried = kept
    .slice(0, first)
    .flatMap((m) => (m.role === "user" ? (m.attachments ?? []).filter((f) => f.textKey) : []));

  // Document text budget goes to the newest documents first; older ones past it are
  // left out (not even read), so a chat full of long files stays cheap per turn.
  const allowance = new Map<string, number>();
  let budgetLeft = DOCUMENT_BUDGET;
  const newestDocs = [
    ...[...recent].reverse().flatMap((m) => (m.role === "user" ? (m.attachments ?? []) : [])),
    ...[...carried].reverse(),
  ];
  for (const f of newestDocs) {
    if (!f.textKey) continue;
    const size = f.chars ?? documentTexts.get(f.textKey)?.length ?? DOCUMENT_BUDGET;
    const share = Math.min(size, budgetLeft);
    allowance.set(f.textKey, share);
    budgetLeft -= share;
  }
  // Every picture of the message being answered goes; from earlier turns only the newest few.
  const imageQuota = new Map<string, number>();
  let imagesLeft = HISTORY_IMAGES;
  for (const m of [...recent].reverse()) {
    if (m.role !== "user") continue;
    const count = fresh.get(m.id)?.length ?? (m.attachments ?? []).filter((f) => f.mime.startsWith("image/")).length;
    if (m === recent[recent.length - 1]) {
      imageQuota.set(m.id, count);
      continue;
    }
    imageQuota.set(m.id, Math.min(count, imagesLeft));
    imagesLeft -= Math.min(count, imagesLeft);
  }
  const loaded = await Promise.all(
    recent.map(async (m, i) => {
      // Pictures drawn by the assistant stay out: models only read the user's files.
      const files = m.role === "user" ? (m.attachments ?? []) : [];
      const pictures = files.filter((f) => f.mime.startsWith("image/"));
      let images = fresh.get(m.id);
      if (!images) {
        const read = await Promise.all(
          pictures.slice(0, imageQuota.get(m.id) ?? 0).map(async (f) => {
            const data = await readFileBase64(f.key);
            return data ? { mime: f.mime, data } : null;
          }),
        );
        images = read.filter((a): a is InlineImage => a !== null);
      }
      const leftOut = (fresh.get(m.id)?.length ?? pictures.length) - images.length;
      const docs = await Promise.all(
        [...(i === 0 ? carried : []), ...files.filter((f) => f.textKey)].map(async (f) => {
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
      return { m, images, docs, leftOut };
    }),
  );
  const history: ChatRequest["messages"] = loaded.map(({ m, images, docs, leftOut }) => {
    const text = leftOut > 0 ? `${m.content}\n[К сообщению были приложены изображения: ${leftOut}]` : m.content;
    return {
      role: m.role,
      content: docs.length ? withDocuments(text, docs) : text,
      attachments: images.length ? images : undefined,
    };
  });
  const messages = mergeTurns(history);

  const assistant = chat.assistantId ? await findAssistant(user.id, chat.assistantId) : undefined;
  const prefs = await userPrefs(user.id);
  const omitted = first > 0 ? [`Начало этого диалога (${first} сообщ.) не поместилось в контекст и здесь не показано.`] : [];

  // MARYX: pick the real model for this message, then speak as MARYX with its memory.
  let route: MaryxPlan | undefined;
  // Stored facts go into every MARYX answer (regenerations too); new ones are learned from new messages.
  const memoryOn = maryx && prefs.memory;
  let facts: string[] = [];
  const last = loaded[loaded.length - 1];
  if (maryx) {
    const previous = recent.findLast((m) => m.role === "assistant");
    try {
      route = await planRoute({
        text: last.m.content,
        hasImages: last.images.length > 0,
        hasDocuments: loaded.some((l) => l.docs.some((d) => d.max > 0)),
        deepThinking: req.deepThinking ?? false,
        webSearch: req.webSearch ?? false,
        previous: previous && {
          provider: previous.provider ?? undefined,
          model: previous.model ?? undefined,
          content: previous.content,
        },
      });
    } catch (err) {
      await refund(user.id, kind);
      return jsonError(describeError(err), 503);
    }
    facts = memoryOn ? (await listFacts(user.id)).map((f) => f.text) : [];
  }
  const plan = route;
  // How hard an OpenRouter model thinks depends on its listed settings (MARYX has loaded them already).
  if (!plan && req.provider === "openrouter") await loadOpenRouterChatModels();
  // MARYX may switch to a fallback model, so its request is built per model.
  const requestFor = (m?: ModelInfo): ChatRequest =>
    m && plan
      ? {
          provider: m.provider,
          model: m.id,
          system: [
            maryxSystem(m, facts, {
              assistantPrompt: assistant?.systemPrompt,
              instructions: prefs.instructions,
              webSearch: plan.webSearch,
            }),
            ...omitted,
          ].join("\n"),
          deepThinking: req.deepThinking,
          webSearch: plan.webSearch,
          // Older pictures can't go to a model that doesn't see images.
          messages: m.vision
            ? messages
            : messages.map((x) =>
                x.attachments
                  ? { ...x, attachments: undefined, content: `${x.content}\n[К сообщению было приложено изображение]` }
                  : x,
              ),
        }
      : {
          provider: req.provider,
          model: req.model,
          system: [assistant?.systemPrompt || DEFAULT_SYSTEM, ...instructionLines(prefs.instructions), ...omitted].join("\n"),
          deepThinking: req.deepThinking,
          webSearch: req.webSearch,
          messages,
        };
  const candidates = plan ? [plan.model, ...plan.fallbacks] : [];
  let provider = plan?.model.provider ?? req.provider;
  let model = plan?.model.id ?? req.model;
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

  // A new MARYX chat with a long first message gets a short name from a fast model.
  // It starts once the answer is actually coming (a failed, refunded answer costs
  // nothing), runs alongside it, and leaves a chat renamed meanwhile alone.
  let titleJob: Promise<string | null> | undefined;
  const firstText = userText.trim();
  const wantTitle = maryx && created && req.message !== undefined && (firstText.length > 40 || firstText.includes("\n"));
  const startTitle = () => {
    const initial = chat.title;
    const names = (req.message?.attachments ?? []).flatMap((f) => (f.name ? [f.name] : []));
    titleJob = suggestTitle(firstText, names)
      .then(async (title) => {
        if (!title || title === initial || request.signal.aborted) return null;
        const renamed = await db
          .update(schema.chat)
          .set({ title })
          .where(and(eq(schema.chat.id, chatId), eq(schema.chat.title, initial)))
          .returning({ id: schema.chat.id });
        return renamed.length ? title : null;
      })
      .catch((err) => {
        console.error("[chat] title failed", err);
        return null;
      });
  };
  if (wantTitle) after(() => titleJob);

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
      let notices: string[] = [];
      const sources: Source[] = [];
      let error: string | undefined;

      // Models MARYX tried that failed, and when it started (a fallback must still fit maxDuration).
      const failed: string[] = [];
      const started = Date.now();
      try {
        for (let attempt = 0; ; ) {
          const current = candidates[attempt];
          if (plan) send({ type: "route", provider, model, search: plan.webSearch || undefined, retry: attempt > 0 || undefined });
          // The browser clears the failed attempt on "retry", then shows why the model changed.
          if (attempt > 0) send({ type: "notice", text: notices[0] });
          try {
            for await (const event of streamChat(requestFor(current), request.signal)) {
              if (event.type === "text") {
                text += event.text;
                if (wantTitle && !titleJob) startTitle();
              } else if (event.type === "reasoning") reasoning += event.text;
              else if (event.type === "notice") notices.push(event.text);
              else if (event.type === "source") sources.push({ url: event.url, title: event.title });
              send(event);
            }
            break;
          } catch (err) {
            if (current) failed.push(current.label);
            // MARYX: a model that fails before writing anything is replaced by the next best
            // one — unless so much time went by (e.g. long thinking) that another answer
            // might not finish before the function's time limit.
            const next =
              current && !text && !request.signal.aborted && Date.now() - started < FALLBACK_WINDOW_MS
                ? nextCandidate(candidates, attempt, err)
                : -1;
            if (next < 0) throw err;
            console.warn("[chat] MARYX falls back from", provider, model, err instanceof Error ? err.message : err);
            const replacement = candidates[next];
            attempt = next;
            provider = replacement.provider;
            model = replacement.id;
            reasoning = "";
            sources.length = 0;
            notices = [`${current.label} сейчас не отвечает — отвечает ${replacement.label}.`];
          }
        }
      } catch (err) {
        if (request.signal.aborted) {
          notices.push("Генерация остановлена.");
        } else {
          console.error("[chat]", provider, model, err);
          error = describeError(err, provider);
          if (!text && failed.length > 1) {
            // Not "X answered instead": nobody did. The browser resets the notice on "retry".
            notices = [`Не ответила ни одна из моделей: ${failed.join(", ")}.`];
            send({ type: "route", provider, model, search: plan?.webSearch || undefined, retry: true });
            send({ type: "notice", text: notices[0] });
          }
        }
      }

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
          via: plan ? "maryx" : null,
        });
        await db.update(schema.chat).set({ updatedAt: new Date() }).where(eq(schema.chat.id, chatId));
      } catch (err) {
        console.error("[chat] failed to save the answer", err);
      }
      // The answer is saved before "done", so a message sent right after it comes later in the chat.
      if (error) send({ type: "error", message: error });
      else if (!request.signal.aborted) send({ type: "done" });

      try {
        if (plan && answered && !request.signal.aborted) {
          const items = await suggestFollowUps(last.m.content || "(документ)", text).catch((err) => {
            console.error("[maryx] follow-ups failed", err);
            return [];
          });
          if (items.length) {
            send({ type: "suggestions", items });
            await db.update(schema.message).set({ suggestions: items }).where(eq(schema.message.id, req.answerId));
          }
        }
        if (titleJob && !request.signal.aborted) {
          const title = await Promise.race([titleJob, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
          if (title) send({ type: "title", title });
        }
      } catch (err) {
        console.error("[chat] after the answer", err);
      }
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return ndjson(body);
}

/**
 * The next model to try after `failed` broke, or -1. A rejected key or an empty
 * balance affects the whole provider account, so that provider is skipped.
 */
function nextCandidate(candidates: ModelInfo[], failed: number, err: unknown): number {
  const status = statusOf(err);
  const account = status === 401 || status === 402 || status === 403;
  for (let i = failed + 1; i < candidates.length; i++) {
    if (!account || candidates[i].provider !== candidates[failed].provider) return i;
  }
  return -1;
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
      } catch (err) {
        if (request.signal.aborted) {
          notice = "Генерация остановлена.";
        } else {
          console.error("[chat:image]", model?.provider, model?.id, err);
          error = describeError(err);
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
        // Like text answers: saved first, so the next message lands after this one.
        if (error) send({ type: "error", message: error });
        else if (!request.signal.aborted) send({ type: "done" });
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
