import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { streamChat } from "@/lib/server/chat";
import { canDrawInChat, chatImageModel, generateChatImage, maryxMediaModels } from "@/lib/server/chat/image";
import { chatMessages, findAssistant, findChat, storedKeys, titleFrom } from "@/lib/server/chats";
import { getDb, schema } from "@/lib/server/db";
import type { StoredFile } from "@/lib/server/db/schema";
import { describeAiError, maryxOnly, publicNotice } from "@/lib/server/brand";
import { StorageUnavailableError, statusOf } from "@/lib/server/errors";
import { loadOpenRouterChatModels } from "@/lib/server/models";
import { jsonError, requireUser, storageUnavailable } from "@/lib/server/http";
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
  wantsImageEdit,
  type MaryxPlan,
} from "@/lib/server/maryx";
import { endUserId, ownKey, ownKeyInfo } from "@/lib/server/own-key";
import { answerLimits, chatHold, mediaCost } from "@/lib/server/pricing";
import { chatEntry, requestChars, type CostEntry, type Meter } from "@/lib/server/spend";
import {
  charge,
  deniedResponse,
  refundCharge,
  reserve,
  settleCharge,
  type Charge,
  type Denial,
} from "@/lib/server/usage";
import { parseChatSendRequest } from "@/lib/server/validate";
import type { ChatRequest, ChatStreamEvent, ChatUsage, InlineImage, ModelInfo, ProviderId, Source, UsageKind } from "@/lib/types";

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

/**
 * An answer still running this long is cut off, so it is saved and its cost
 * recorded before the platform stops the function at maxDuration.
 */
const ANSWER_DEADLINE_MS = (maxDuration - 20) * 1000;
const CUT_OFF = "Ответ обрезан: модель отвечала дольше 5 минут. Попросите продолжить или упростите задачу.";
/** What the adapters say when an answer reached its length limit. */
const LENGTH_NOTICE = "Ответ обрезан: достигнут лимит длины.";
/** An answer cut short because what the budget or credits had left paid for no more. */
const SHORT_NOTICE = {
  plan: "Ответ обрезан: на длинный ответ не хватило остатка дневного бюджета. Продолжите завтра или пополните кредиты.",
  credits: "Ответ обрезан: на длинный ответ не хватило кредитов. Пополните их, чтобы получать ответы полной длины.",
};

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
  // The answer's deadline counts from here: preparing a big request takes part of maxDuration too.
  const requestStarted = Date.now();
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const req = parseChatSendRequest(await request.json().catch(() => null));
  if (typeof req === "string") return jsonError(req, 400);

  const db = await getDb();
  let chat = await findChat(user.id, req.chatId);
  if (!chat && (!req.create || !req.message)) return jsonError("Чат не найден", 404);

  const maryx = req.provider === "maryx";
  // With their own OpenRouter key, the user's OpenRouter requests (MARYX picks only those) go out with it.
  const key = req.provider === "openrouter" || maryx || req.image ? await ownKey(user.id) : undefined;
  // MARYX draws by itself when asked to ("нарисуй…", no files attached) and an image model is set up.
  const autoDraw =
    maryx &&
    !req.image &&
    req.message !== undefined &&
    !req.message.attachments?.length &&
    wantsImage(req.message.content) &&
    (await canDrawInChat(Boolean(key)));
  // Photos of the new message: in "Картинка" mode (or when asked to edit them) they are what gets edited.
  const newPhotos = (req.message?.attachments ?? []).filter((a) => a.mime.startsWith("image/"));
  // MARYX edits the attached photo by itself when asked to ("обработай фото", "убери фон"), with no documents along.
  const autoEdit =
    maryx &&
    !req.image &&
    req.message !== undefined &&
    newPhotos.length > 0 &&
    newPhotos.length === req.message.attachments?.length &&
    wantsImageEdit(req.message.content) &&
    (await canDrawInChat(Boolean(key), true));
  const editing = autoEdit || (req.image && newPhotos.length > 0);
  const refuse = async (k: UsageKind, denied: Denial, c?: Charge) =>
    deniedResponse(user, k, denied, { ownKey: key !== undefined || Boolean(await ownKeyInfo(user.id)), charge: c });
  // A picture's price is known up front, so it is held against budgets and credits right away.
  const chargeDrawing = async (): Promise<Charge | { denied: Denial; charge?: Charge }> => {
    const c = await charge(user, "image", key);
    if ("denied" in c) return c;
    let refused: Denial | null;
    try {
      // With no image model set up, drawInChat says so (and refunds); hold a typical picture meanwhile.
      const picked = await chatImageModel(Boolean(c.key), editing).catch(() => null);
      refused = await reserve(c, mediaCost("image", picked?.id ?? ""), {
        provider: picked?.provider ?? "openrouter",
        model: picked?.id ?? "image",
      });
    } catch (err) {
      await refundCharge(c);
      throw err;
    }
    if (!refused) return c;
    await refundCharge(c);
    return { denied: refused, charge: c };
  };
  let draw = req.image || autoDraw || autoEdit;
  // A picture drawn in the chat counts toward the image limit, not messages.
  let kind: UsageKind = draw ? "image" : "chat";
  let paid = draw ? await chargeDrawing() : await charge(user, "chat", key);
  if ("denied" in paid) {
    // MARYX chose to draw (or edit) on its own: with no pictures left today, answer in words.
    if (!autoDraw && !autoEdit) return refuse(kind, paid.denied, (paid as { charge?: Charge }).charge);
    paid = await charge(user, "chat", key);
    if ("denied" in paid) return refuse("chat", paid.denied);
    draw = false;
    kind = "chat";
  }
  const bill: Charge = paid;

  const answer = async (): Promise<Response> => {
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
        await refundCharge(bill);
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
    // Files of the new message, and the answer a regeneration will replace once it's allowed to run.
    const stored: StoredFile[] = [];
    let replaced: Awaited<ReturnType<typeof chatMessages>>[number] | undefined;
    if (req.message) {
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
        if (err instanceof DocumentLimitError) await settleCharge(bill, []);
        else await refundCharge(bill);
        // Don't leave an empty chat behind when its first message was refused.
        if (created) await db.delete(schema.chat).where(and(eq(schema.chat.id, chat.id), eq(schema.chat.userId, user.id)));
        if (err instanceof DocumentError) return jsonError(err.message, 400);
        if (err instanceof StorageUnavailableError) return storageUnavailable(user, err.message);
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
        await refundCharge(bill);
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
        await refundCharge(bill);
        return jsonError("Это сообщение не сохранилось — отправьте его ещё раз.", 409);
      }
      const last = existing[existing.length - 1];
      if (last?.role === "assistant") replaced = last;
    }
    const chatId = chat.id;
    const chatTitle = chat.title;

    // The old answer goes only once the new one may run, so a refused regeneration keeps it.
    const commitReplace = async () => {
      if (!replaced) return;
      await db.delete(schema.message).where(and(eq(schema.message.id, replaced.id), eq(schema.message.chatId, chatId)));
      // A replaced drawing takes its picture with it.
      await deleteFiles(storedKeys(replaced.attachments ?? [])).catch(() => {});
    };
    // A request refused once its cost is known leaves nothing behind: the message, its files, a new chat.
    const undoMessage = async () => {
      if (req.message) {
        await db.delete(schema.message).where(and(eq(schema.message.id, req.message.id), eq(schema.message.chatId, chatId)));
        await deleteFiles(storedKeys(stored)).catch(() => {});
      }
      if (created) await db.delete(schema.chat).where(and(eq(schema.chat.id, chatId), eq(schema.chat.userId, user.id)));
    };

    const rows = (await chatMessages(chatId)).filter((m) => m.id !== replaced?.id);
    if (rows[rows.length - 1]?.role !== "user") {
      await refundCharge(bill);
      return jsonError("Нечего отправлять: последнее сообщение не от пользователя", 400);
    }

    if (draw) {
      await commitReplace();
      const asked = rows[rows.length - 1];
      // The photos to edit: the new message's, or (when an edit is drawn again) the stored ones.
      const photos = req.message
        ? newPhotos.map(({ mime, data }) => ({ mime, data }))
        : await storedPhotos(asked.attachments);
      return drawInChat(request, bill, chatId, req.answerId, asked.content, maryx ? "maryx" : undefined, photos);
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
          ownKey: Boolean(bill.key),
        });
      } catch (err) {
        await refundCharge(bill);
        return jsonError(describeAiError(err), 503);
      }
      facts = memoryOn ? (await listFacts(user.id)).map((f) => f.text) : [];
    }
    const plan = route;
    // How hard an OpenRouter model thinks depends on its listed settings (MARYX has loaded them already).
    if (!plan && req.provider === "openrouter") await loadOpenRouterChatModels(Boolean(bill.key));
    const endUser = endUserId(user.id);
    const deep = Boolean(req.deepThinking);
    const paid = bill.paidBy !== "byok" && bill.paidBy !== "admin";
    /** What a model call may still spend: what the budget or credits had left for this request, less earlier attempts. */
    const leftAfter = (spent: number) => (paid && bill.room !== undefined ? bill.room - spent : undefined);
    const holdOf = (call: ChatRequest) => chatHold(call.provider, call.model, requestChars(call), deep, Boolean(call.webSearch));
    // MARYX may switch to a fallback model, so its request is built per model. A request the
    // site or credits pay for is limited to what they had left for it, when that is less than
    // a full-length answer: it may then think less, so there's room for the answer itself.
    const requestFor = (m: ModelInfo | undefined, spent: number): { call: ChatRequest; limited: boolean } => {
      const call = baseRequest(m);
      const limits = paid
        ? answerLimits(call.provider, call.model, requestChars(call), deep, leftAfter(spent), Boolean(call.webSearch))
        : undefined;
      const effort =
        limits?.effort === "light" ? { deepThinking: false, light: true } : deep && limits?.effort === "normal" ? { deepThinking: false } : {};
      return {
        limited: Boolean(limits?.limited),
        call: {
          ...call,
          ...effort,
          apiKey: call.provider === "openrouter" ? bill.key : undefined,
          endUser,
          maxTokens: limits?.maxTokens,
        },
      };
    };
    /** A fallback that what's left can't pay even a short answer of isn't tried. */
    const affordable = (m: ModelInfo, spent: number) => {
      const left = leftAfter(spent);
      return left === undefined || left >= holdOf(baseRequest(m)).least;
    };
    const baseRequest = (m?: ModelInfo): ChatRequest =>
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

    // Now the model and the input are known: hold what the answer may cost while it runs.
    const firstCall = baseRequest(candidates[0]);
    const refused = await reserve(bill, holdOf(firstCall), { provider: firstCall.provider, model: firstCall.model });
    if (refused) {
      await undoMessage();
      await refundCharge(bill);
      return refuse("chat", refused, bill);
    }
    await commitReplace();
    // MARYX's own jobs for this message (title, follow-ups, memory) are recorded against it.
    const meter: Meter = { userId: user.id, paidBy: bill.paidBy, key: bill.key };

    // After the answer is sent: let MARYX note lasting facts from this message —
    // only when the answer actually came through (a failed one is refunded).
    const userText = req.message?.content ?? "";
    let answered = false;
    if (memoryOn && req.message && mightHaveFacts(userText)) {
      after(() =>
        answered
          ? rememberFrom(user.id, userText, meter).catch((err) => console.error("[maryx] memory update failed", err))
          : undefined,
      );
    }

    // A new MARYX chat with a long first message gets a short name from a fast model.
    // It starts once the answer is actually coming (a failed, refunded answer costs
    // nothing), runs alongside it, and leaves a chat renamed meanwhile alone.
    let titleJob: Promise<string | null> | undefined;
    const firstText = userText.trim();
    const wantTitle = maryx && created && req.message !== undefined && (firstText.length > 40 || firstText.includes("\n"));
    const startTitle = () => {
      const initial = chatTitle;
      const names = (req.message?.attachments ?? []).flatMap((f) => (f.name ? [f.name] : []));
      titleJob = suggestTitle(firstText, names, meter)
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
        // The answer stops when the user stops it, or just before the function's time limit.
        const deadline = AbortSignal.timeout(Math.max(1000, ANSWER_DEADLINE_MS - (Date.now() - requestStarted)));
        const signal = AbortSignal.any([request.signal, deadline]);
        // What each model call cost: reported by the provider, else estimated from what was sent and streamed.
        const costs: CostEntry[] = [];
        let usage: ChatUsage | undefined;
        let sent = 0;
        let produced = 0;
        let callStarted = 0;
        let callLimit: number | undefined;
        // The answer had to be limited to what the budget or credits had left.
        let limitedCall = false;
        // Model calls actually made; one stopped before any started costs nothing and is refunded.
        let calls = 0;
        const spentSoFar = () => costs.reduce((sum, e) => sum + e.usd, 0);
        // `complete`: the call ran to its end, so the usage it reported is final (else only a lower bound).
        const tally = (complete: boolean) => {
          const stopped = signal.aborted ? { seconds: (Date.now() - callStarted) / 1000, maxTokens: callLimit } : undefined;
          const entry = chatEntry("chat", provider, model, usage, { input: sent, output: produced }, stopped, !complete);
          if (entry) costs.push(entry);
          usage = undefined;
          produced = 0;
        };
        const cutOff = () => {
          notices.push(CUT_OFF);
          send({ type: "notice", text: CUT_OFF });
        };
        try {
          for (let attempt = 0; ; ) {
            const current = candidates[attempt];
            if (plan) send({ type: "route", ...shown(provider, model), search: plan.webSearch || undefined, retry: attempt > 0 || undefined });
            // The browser clears the failed attempt on "retry", then shows why the model changed.
            if (attempt > 0 && notices[0]) send({ type: "notice", text: notices[0] });
            const { call, limited } = requestFor(current, spentSoFar());
            limitedCall = limited;
            callLimit = call.maxTokens;
            sent = requestChars(call);
            callStarted = Date.now();
            if (signal.aborted) {
              // Stopped while the request was still being prepared: no model was asked.
              if (request.signal.aborted) notices.push("Генерация остановлена.");
              else cutOff();
              break;
            }
            calls++;
            try {
              for await (let event of streamChat(call, signal)) {
                if (event.type === "usage") {
                  usage = event.usage;
                  continue; // for the ledger only
                }
                // An answer cut short because the budget or credits had little left: say why.
                if (event.type === "notice" && event.text === LENGTH_NOTICE && limitedCall) {
                  event = { type: "notice", text: bill.paidBy === "credits" ? SHORT_NOTICE.credits : SHORT_NOTICE.plan };
                }
                if (event.type === "text") {
                  text += event.text;
                  produced += event.text.length;
                  if (wantTitle && !titleJob) startTitle();
                } else if (event.type === "reasoning") {
                  reasoning += event.text;
                  produced += event.text.length;
                } else if (event.type === "notice") {
                  // In MARYX-only mode, notices naming the model behind it are dropped or reworded.
                  const notice = publicNotice(event.text);
                  if (notice === undefined) continue;
                  event = { type: "notice", text: notice };
                  notices.push(notice);
                } else if (event.type === "source") sources.push({ url: event.url, title: event.title });
                send(event);
              }
              tally(!signal.aborted);
              // Some SDKs end a stopped stream quietly instead of throwing.
              if (request.signal.aborted) notices.push("Генерация остановлена.");
              else if (deadline.aborted) cutOff();
              break;
            } catch (err) {
              tally(false);
              if (current) failed.push(current.label);
              // MARYX: a model that fails before writing anything is replaced by the next best
              // one — unless so much time went by (e.g. long thinking) that another answer
              // might not finish before the function's time limit.
              const next =
                current && !text && !signal.aborted && Date.now() - started < FALLBACK_WINDOW_MS
                  ? nextCandidate(candidates, attempt, err, (m) => affordable(m, spentSoFar()))
                  : -1;
              if (next < 0) throw err;
              console.warn("[chat] MARYX falls back from", provider, model, err instanceof Error ? err.message : err);
              const replacement = candidates[next];
              attempt = next;
              provider = replacement.provider;
              model = replacement.id;
              reasoning = "";
              sources.length = 0;
              // Which model stood in is MARYX's own business in MARYX-only mode.
              notices = maryxOnly() ? [] : [`${current.label} сейчас не отвечает — отвечает ${replacement.label}.`];
            }
          }
        } catch (err) {
          if (request.signal.aborted) {
            notices.push("Генерация остановлена.");
          } else if (deadline.aborted) {
            cutOff();
          } else {
            console.error("[chat]", provider, model, err);
            error = describeAiError(err, provider, Boolean(bill.key));
            if (!text && failed.length > 1 && !maryxOnly()) {
              // Not "X answered instead": nobody did. The browser resets the notice on "retry".
              notices = [`Не ответила ни одна из моделей: ${failed.join(", ")}.`];
              send({ type: "route", provider, model, search: plan?.webSearch || undefined, retry: true });
              send({ type: "notice", text: notices[0] });
            }
          }
        }

        try {
          // A provider failure that produced nothing, or an answer that ran out of length while
          // still thinking, doesn't count toward the limit (its cost is still recorded, and on a
          // plan still counts toward the budget). Credits pay for what it cost, also for such an
          // answer whose thinking was shown.
          const cutBeforeAnswer =
            !text &&
            notices.some((n) => n === LENGTH_NOTICE || n === SHORT_NOTICE.plan || n === SHORT_NOTICE.credits) &&
            (bill.paidBy !== "credits" || !reasoning.trim());
          await settleCharge(bill, costs, calls === 0 || Boolean(error && !text) || cutBeforeAnswer);
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
          if (plan && answered && !signal.aborted) {
            const items = await suggestFollowUps(last.m.content || "(документ)", text, meter).catch((err) => {
              console.error("[maryx] follow-ups failed", err);
              return [];
            });
            if (items.length) {
              send({ type: "suggestions", items });
              await db.update(schema.message).set({ suggestions: items }).where(eq(schema.message.id, req.answerId));
            }
          }
          if (titleJob && !signal.aborted) {
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
  };

  try {
    return await answer();
  } catch (err) {
    // Something broke before the answer started: give the charge back (a no-op if already settled).
    await refundCharge(bill);
    throw err;
  }
}

/**
 * The model the browser is told answered: the real one, or in MARYX-only mode
 * MARYX itself (the real one is still stored, for routing and costs).
 */
function shown(provider: ProviderId, model: string, drawing = false): { provider: ProviderId; model: string } {
  return maryxOnly() ? { provider: "maryx", model: drawing ? "maryx-image" : "maryx" } : { provider, model };
}

/**
 * The next model to try after `failed` broke, or -1. A rejected key or an empty
 * balance affects the whole provider account, so that provider is skipped; so
 * is a model the request can't `afford`.
 */
function nextCandidate(candidates: ModelInfo[], failed: number, err: unknown, afford: (m: ModelInfo) => boolean): number {
  const status = statusOf(err);
  // OpenRouter answers 403 when one model's moderation flags the input: another model may still answer.
  const account = status === 401 || status === 402 || (status === 403 && candidates[failed].provider !== "openrouter");
  for (let i = failed + 1; i < candidates.length; i++) {
    if ((!account || candidates[i].provider !== candidates[failed].provider) && afford(candidates[i])) return i;
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

/** The photos stored with a message (to edit them again), as inline images. */
async function storedPhotos(files: StoredFile[] | null | undefined): Promise<InlineImage[]> {
  const photos: InlineImage[] = [];
  for (const f of (files ?? []).filter((f) => f.mime.startsWith("image/")).slice(0, 4)) {
    const data = await readFileBase64(f.key);
    if (data) photos.push({ mime: f.mime, data });
  }
  return photos;
}

/**
 * Image mode: draws a picture from the last user message (or edits the
 * `photos` attached to it) and stores it as the answer. Streams the same
 * NDJSON events as a text answer, plus "image".
 */
function drawInChat(
  request: Request,
  bill: Charge,
  chatId: string,
  answerId: string,
  prompt: string,
  via?: "maryx",
  photos: InlineImage[] = [],
): Response {
  const userId = bill.userId;
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
      let cost: number | undefined;
      // What the provider billed for a picture that couldn't be stored.
      let billed: { usd: number; reported: boolean } | undefined;
      let model: { provider: ChatRequest["provider"]; id: string } | undefined;
      let text = "";
      let error: string | undefined;
      let notice: string | undefined;
      // Which model made (or last tried) the picture, also when it fails.
      const tried: { model?: ModelInfo } = {};
      try {
        const editing = photos.length > 0;
        // A picture needs a description (an attached photo can be edited without one).
        if (!editing && !prompt.trim()) throw new Error("Опишите картинку словами — и MARYX её нарисует.");
        // Says what to set up when no model can draw (or edit photos).
        const picked = await chatImageModel(Boolean(bill.key), editing);
        model = picked;
        if (via) send({ type: "route", ...shown(picked.provider, picked.id, true), image: true });
        const models = await maryxMediaModels("image", Boolean(bill.key), editing);
        let made: ModelInfo;
        ({ files, cost, model: made } = await generateChatImage(
          userId,
          prompt,
          models.length ? models : [picked],
          request.signal,
          { key: bill.key, endUser: endUserId(userId) },
          photos,
          tried,
        ));
        model = made;
        for (const f of files) {
          send({ type: "image", url: fileUrl(f.key), mime: f.mime, ...shown(made.provider, made.id, true) });
        }
        text = editing ? "Готово! Вот обработанное фото." : "Готово! Вот что получилось.";
        send({ type: "text", text });
      } catch (err) {
        if (tried.model) model = tried.model;
        const lost = err as { billed?: number; reported?: boolean };
        if (typeof lost.billed === "number") billed = { usd: lost.billed, reported: Boolean(lost.reported) };
        if (request.signal.aborted) {
          notice = "Генерация остановлена.";
        } else {
          console.error("[chat:image]", model?.provider, model?.id, err);
          error = describeAiError(err, model?.provider, Boolean(bill.key));
        }
      } finally {
        try {
          // A picture that didn't reach the user is refunded; what the provider billed is still recorded.
          const usd = files.length ? (cost ?? (model ? mediaCost("image", model.id) : 0)) : billed?.usd;
          const estimated = files.length ? cost === undefined : !billed?.reported;
          await settleCharge(
            bill,
            model && usd !== undefined ? [{ kind: "image", provider: model.provider, model: model.id, usd, estimated }] : [],
            !files.length,
          );
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
