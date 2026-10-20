import { and, eq, inArray } from "drizzle-orm";
import { after } from "next/server";
import { streamChat } from "@/lib/server/chat";
import { isAdmin, type SessionUser } from "@/lib/server/auth";
import {
  canDrawInChat,
  canFilmInChat,
  chatImageModel,
  freePlanPhotos,
  freeLane,
  generateChatImage,
  maryxMediaModel,
  maryxMediaModels,
} from "@/lib/server/chat/image";
import { chatMessages, findAssistant, findChat, storedKeys, titleFrom } from "@/lib/server/chats";
import { getDb, schema } from "@/lib/server/db";
import type { StoredFile } from "@/lib/server/db/schema";
import { describeAiError, maryxOnly, publicNotice } from "@/lib/server/brand";
import { errorDetail, StorageUnavailableError, statusOf } from "@/lib/server/errors";
import { loadOpenRouterChatModels } from "@/lib/server/models";
import { jsonError, loginRequired, requireUser, storageUnavailable } from "@/lib/server/http";
import { IMAGE_STYLES, withStyle } from "@/lib/effects";
import { startMediaJob } from "@/lib/server/media-job";
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
  research,
  researchBrief,
  council,
  councilBrief,
  rememberFrom,
  suggestFollowUps,
  suggestTitle,
  summarizeChat,
  userPrefs,
  wantsImage,
  wantsAnimate,
  wantsFollowUpEdit,
  wantsImageEdit,
  wantsVideo,
  type MaryxPlan,
} from "@/lib/server/maryx";
import { endUserId, ownKey, ownKeyInfo } from "@/lib/server/own-key";
import { installedPlugins, pluginContext } from "@/lib/server/plugins";
import { answerLimits, chatHold, mediaCost } from "@/lib/server/pricing";
import { chatEntry, requestChars, type CostEntry, type Meter } from "@/lib/server/spend";
import { isOwnVideoKey } from "@/lib/server/uploads";
import {
  charge,
  chargePhotoEdit,
  deniedResponse,
  refundCharge,
  reserve,
  settleCharge,
  type Charge,
  type Denial,
} from "@/lib/server/usage";
import { parseChatSendRequest } from "@/lib/server/validate";
import type {
  AspectRatio,
  ChatRequest,
  ChatStreamEvent,
  ChatUsage,
  InlineFile,
  InlineImage,
  MediaItem,
  MediaKind,
  ModelInfo,
  ProviderId,
  Source,
  UsageKind,
} from "@/lib/types";

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

/** What deep research's searches may cost on top of the report, held with it. */
const RESEARCH_HOLD_USD = 0.08;
/** What the council's experts may cost on top of the answer, held with it. */
const COUNCIL_HOLD_USD = 0.1;

/** A video answer tries MARYX's next model only this soon (starting a clip is quick; making it is in the background). */
const VIDEO_FALLBACK_WINDOW_MS = 60_000;

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
  const user = await requireUser(request, { guest: true });
  if (user instanceof Response) return user;

  const req = parseChatSendRequest(await request.json().catch(() => null));
  if (typeof req === "string") return jsonError(req, 400);
  // An uploaded video must be one of the user's own files.
  if (req.message?.attachments?.some((a) => a.key && !isOwnVideoKey(user.id, a.key))) return jsonError("Неверное вложение", 400);
  // A guest only chats (pictures and video are refused when charged): files and the heavier modes need an account.
  if (user.isAnonymous && req.message?.attachments?.length) {
    return loginRequired("Чтобы прикреплять фото и файлы, войдите или зарегистрируйтесь — это бесплатно.");
  }
  if (user.isAnonymous && (req.research || req.council)) {
    return loginRequired(`Чтобы ${req.research ? "запускать глубокое исследование" : "звать совет экспертов"}, войдите или зарегистрируйтесь — это бесплатно.`);
  }

  const db = await getDb();
  const maryx = req.provider === "maryx";
  // The chat and the user's own key are read at once (two round trips to the database, not one after the other).
  const [found, savedKey] = await Promise.all([
    findChat(user.id, req.chatId),
    // With their own OpenRouter key, the user's OpenRouter requests (MARYX picks only those) go out with it.
    req.provider === "openrouter" || maryx || req.image || req.video ? ownKey(user.id) : undefined,
  ]);
  let chat = found;
  if (!chat && (!req.create || !req.message)) return jsonError("Чат не найден", 404);

  // A corrected question replaces the chat's last one. Its pictures go along again (as if attached
  // anew), so a corrected edit, drawing or video works like the first; its documents are carried over.
  let replacing: { rows: Awaited<ReturnType<typeof chatMessages>>; documents: StoredFile[]; first: boolean } | null = null;
  if (req.replace && req.message) {
    const existing = chat ? await chatMessages(chat.id) : [];
    const i = existing.findLastIndex((m) => m.role === "user");
    if (i < 0 || existing[i].id !== req.replace) return jsonError("Это сообщение уже нельзя изменить — обновите страницу.", 409);
    const files = existing[i].attachments ?? [];
    const pictures: InlineFile[] = [];
    for (const f of files.filter((f) => f.mime.startsWith("image/")).slice(0, 4)) {
      const data = await readFileBase64(f.key);
      if (data) pictures.push({ mime: f.mime, data, name: f.name, ...(f.hidden ? { hidden: true } : {}) });
    }
    req.message.attachments = pictures.length ? pictures : undefined;
    replacing = { rows: existing.slice(i), documents: files.filter((f) => !f.mime.startsWith("image/")), first: i === 0 };
  }

  const key = savedKey;
  const text = req.message?.content ?? "";
  // "Оживи фото": a video that starts from the picture (attached, or the one just made).
  const animate = req.message !== undefined && wantsAnimate(text);
  const videoWords = (maryx || req.video) && !req.image && (animate || wantsVideo(text));
  // Nano Banana style: right after a picture, "сделай фон синим" edits that picture and "оживи" brings it to
  // life. It goes along as the message's own photo (and is stored with it), so making the answer again uses it.
  const focus =
    chat && req.message && !replacing && !req.message.attachments?.length &&
    (videoWords ? animate : (maryx || req.image) && !req.video && wantsFollowUpEdit(text))
      ? await pictureInFocus(chat.id)
      : null;
  const followUp =
    focus !== null && (videoWords ? await canFilmInChat(Boolean(key), true) : await canDrawInChat(Boolean(key), true));
  if (followUp && focus && req.message) req.message.attachments = [focus];
  // Photos of the new message: what gets edited (or, for a video, its first frame).
  const newPhotos = (req.message?.attachments ?? []).filter((a) => a.mime.startsWith("image/"));
  // MARYX makes a video by itself when asked to ("сними видео…", or "оживи" with a picture to animate).
  const autoFilm =
    maryx &&
    !req.image &&
    !req.video &&
    videoWords &&
    (!animate || newPhotos.length > 0) &&
    (await canFilmInChat(Boolean(key), newPhotos.length > 0));
  const film = req.video || autoFilm;
  // MARYX draws by itself when asked to ("нарисуй…", no files attached) and an image model is set up.
  const autoDraw =
    maryx &&
    !film &&
    !req.image &&
    req.message !== undefined &&
    !req.message.attachments?.length &&
    wantsImage(text) &&
    (await canDrawInChat(Boolean(key)));
  // MARYX edits the attached photo by itself when asked to ("обработай фото", "убери фон"), with no documents along.
  const autoEdit =
    maryx &&
    !film &&
    !req.image &&
    req.message !== undefined &&
    newPhotos.length > 0 &&
    newPhotos.length === req.message.attachments?.length &&
    (followUp || (wantsImageEdit(text) && (await canDrawInChat(Boolean(key), true))));
  // Made again (no new message): from the asked message's photos when it carries some, so the right model's price is held.
  const withPhotos = req.message
    ? newPhotos.length > 0
    : (req.image || film) && chat
      ? await askedHasPhotos(chat.id)
      : false;
  const editing = autoEdit || (Boolean(req.image) && withPhotos);
  const refuse = async (k: UsageKind, denied: Denial, c?: Charge, reason?: string) =>
    deniedResponse(user, k, denied, { ownKey: key !== undefined || Boolean(await ownKeyInfo(user.id)), charge: c, reason });
  // A picture's (or clip's) price is known up front, so it is held against budgets and credits right away.
  const chargeMedia = async (k: MediaKind, photos: boolean): Promise<Charge | { denied: Denial; charge?: Charge; reason?: string }> => {
    let c = await charge(user, k, key);
    if ("denied" in c) return c;
    // The free model can't edit photos: on the free plan, a few a day are made like a paid plan's, then credits pay.
    if (photos && freeLane(c, k)) {
      await refundCharge(c);
      c = await chargePhotoEdit(user, key);
      if ("denied" in c) return c.denied === "busy" ? c : { ...c, reason: freePlanPhotos() };
    }
    let refused: Denial | null;
    try {
      // With no model set up, the answer says so (and refunds); hold a typical price meanwhile.
      const picked = await maryxMediaModel(k, Boolean(c.key), photos, { free: freeLane(c, k) }).catch(() => null);
      refused = await reserve(c, mediaCost(k, picked?.id ?? ""), {
        provider: picked?.provider ?? "openrouter",
        model: picked?.id ?? k,
      });
    } catch (err) {
      await refundCharge(c);
      throw err;
    }
    if (!refused) return c;
    await refundCharge(c);
    return { denied: refused, charge: c };
  };
  let draw = !film && (req.image || autoDraw || autoEdit);
  // A picture (or clip) made in the chat counts toward the image (video) limit, not messages.
  let kind: UsageKind = film ? "video" : draw ? "image" : "chat";
  let paid = film
    ? await chargeMedia("video", withPhotos)
    : draw
      ? await chargeMedia("image", editing)
      : await charge(user, "chat", key);
  if ("denied" in paid) {
    // MARYX chose to draw (or edit) on its own: with no pictures left today, answer in words.
    // A video isn't something words can stand in for: the user is told why (and about plans).
    // …unless it's a photo edit on the free plan: the user is told it's for credits or a paid plan.
    const why = paid as { charge?: Charge; reason?: string };
    // A guest is asked to sign up instead (drawing is free with an account).
    if (film || (!autoDraw && !autoEdit) || why.reason || user.isAnonymous) return refuse(kind, paid.denied, why.charge, why.reason);
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
            temporary: req.create.temporary === true,
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

    // The chat's new name, when a corrected first question renames it.
    let retitled: string | undefined;
    // Text of documents attached to the new message (by text key), to skip re-reading it.
    const documentTexts = new Map<string, string>();
    // Files of the new message, and the answer a regeneration will replace once it's allowed to run.
    const stored: StoredFile[] = [];
    let replaced: Awaited<ReturnType<typeof chatMessages>>[number] | undefined;
    if (req.message) {
      // A corrected question takes the place of the last one, and its answer goes. Its documents
      // stay with it; its pictures were read back above and are stored again as the new message's.
      if (replacing) {
        const { rows: gone, documents } = replacing;
        await db.delete(schema.message).where(
          and(eq(schema.message.chatId, chat.id), inArray(schema.message.id, gone.map((m) => m.id))),
        );
        stored.push(...documents);
        const dropped = gone.flatMap((m) => m.attachments ?? []).filter((f) => !documents.includes(f));
        await deleteFiles(storedKeys(dropped)).catch(() => {});
        // A chat still named after the question it starts with follows the correction.
        const old = gone[0];
        const oldFiles = (old.attachments ?? []).map((f) => ({ mime: f.mime, data: "", name: f.name }));
        if (replacing.first && chat.title === titleFrom(old.content, oldFiles)) {
          const title = titleFrom(req.message.content, req.message.attachments);
          await db.update(schema.chat).set({ title }).where(eq(schema.chat.id, chat.id));
          chat = { ...chat, title };
          retitled = title;
        }
      }
      try {
        for (const file of req.message.attachments ?? []) {
          // A whole video, uploaded beforehand: already stored (its ownership was checked above).
          if (file.key) {
            stored.push({ key: file.key, mime: file.mime, name: file.name });
            continue;
          }
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
            stored.push({ key, mime: file.mime, name: file.name, ...(file.hidden ? { hidden: true } : {}) });
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

    if (draw || film) {
      await commitReplace();
      const asked = rows[rows.length - 1];
      // The photos to edit (or animate): the new message's, or (when made again) the stored ones.
      const photos = req.message
        ? newPhotos.map(({ mime, data }) => ({ mime, data }))
        : await storedPhotos(asked.attachments);
      // A follow-up: the browser shows the picture being changed (or animated) on the user's message.
      const attached =
        followUp && req.message && stored[0]
          ? { type: "attached" as const, messageId: req.message.id, url: fileUrl(stored[0].key), mime: stored[0].mime }
          : undefined;
      const via = maryx ? ("maryx" as const) : undefined;
      if (film) {
        return filmInChat(request, user, bill, chatId, req.answerId, asked.content, photos.slice(0, 1), {
          via,
          camera: req.camera,
          attached,
          until: requestStarted + VIDEO_FALLBACK_WINDOW_MS,
        });
      }
      // A new picture takes the chosen look (an edited photo keeps its own).
      const style = photos.length ? undefined : IMAGE_STYLES.find((s) => s.id === req.style);
      return drawInChat(request, bill, chatId, req.answerId, withStyle(asked.content, style), via, photos, attached);
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
      // A whole video plays in the chat; the model gets its frames (sent unseen), and is told what they are.
      const videos = (m.role === "user" ? (m.attachments ?? []) : []).filter((f) => f.hidden).map((f) => f.name || "Видео");
      const watched = videos.length
        ? `\n[Пользователь прислал видео (${videos.join("; ")}). Приложенная картинка — его кадры по порядку, на каждом отмечено время. Если он ничего не спросил, расскажи, что происходит на видео.]`
        : "";
      const text = (leftOut > 0 ? `${m.content}\n[К сообщению были приложены изображения: ${leftOut}]` : m.content) + watched;
      return {
        role: m.role,
        content: docs.length ? withDocuments(text, docs) : text,
        attachments: images.length ? images : undefined,
      };
    });
    const messages = mergeTurns(history);

    // MARYX: pick the real model for this message, then speak as MARYX with its memory.
    // Deep research: searches run first (in the answer's stream), and the report is written from them.
    const researching = maryx && req.research === true;
    let researchText = "";
    // Консилиум: strong models answer first (in the answer's stream), and the answer combines them.
    // Experts read only words, so a question with pictures is answered the usual way.
    const consulting = maryx && !researching && req.council === true && loaded[loaded.length - 1].images.length === 0;
    let councilText = "";
    let pluginText = "";
    const last = loaded[loaded.length - 1];
    const previous = recent.findLast((m) => m.role === "assistant");
    // What the answer needs from the database, and its model, at once rather than one after another
    // (each is a round trip to the database; the facts are read even if memory turns out to be off).
    const [assistant, prefs, plugins, storedFacts, routed] = await Promise.all([
      chat.assistantId ? findAssistant(user.id, chat.assistantId) : undefined,
      userPrefs(user.id),
      // «Плагины»: fresh data (weather, rates, news…) from the user's plugins, when the message calls for it.
      maryx && !researching ? installedPlugins(user.id) : [],
      // A temporary chat stays out of MARYX's memory (neither read nor learned from).
      maryx && !chat.temporary ? listFacts(user.id) : [],
      maryx
        ? planRoute({
            research: researching,
            strong: consulting,
            // «Ответить лучше» redoes `replaced` with a stronger model.
            better: req.better && replaced ? { provider: replaced.provider ?? undefined, model: replaced.model ?? undefined } : undefined,
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
          }).then(
            (plan) => ({ plan }),
            (error: unknown) => ({ error }),
          )
        : undefined,
    ]);
    // The chat's first question usually sets the task: it stays in view even when its turn doesn't fit.
    const left = kept.slice(0, first);
    const opening = first > 0 ? left.find((m) => m.role === "user" && m.content.trim()) : undefined;
    // …and what MARYX retold of the turns left out (see summarizeChat below).
    const retold = first > 0 && chat.summary ? chat.summary : "";
    const omitted =
      first > 0
        ? [
            `Начало этого диалога (${first} сообщ.) не поместилось в контекст и здесь не показано.`,
            ...(opening ? [`С чего пользователь начал этот диалог (учитывай как контекст задачи): «${shorten(opening.content, 2000)}»`] : []),
            ...(retold ? [`Краткое содержание той части разговора (помни его, отвечая):\n${retold}`] : []),
          ]
        : [];
    // Turns left out that the retelling doesn't cover yet: once there are enough, it's redone after the answer.
    const retoldThrough = chat.summarySeq ?? -1;
    const unretold = left.filter((m) => m.seq > retoldThrough && m.content.trim());
    const retell = first > 0 && unretold.length > 0 && (!chat.summary || unretold.reduce((n, m) => n + m.content.length, 0) > 6000);

    // Stored facts go into every MARYX answer (regenerations too); new ones are learned from new messages.
    const memoryOn = maryx && prefs.memory && !chat.temporary;
    const facts: string[] = memoryOn ? storedFacts.map((f) => f.text) : [];
    if (routed && "error" in routed) {
      await refundCharge(bill);
      return jsonError(describeAiError(routed.error), 503);
    }
    const plan: MaryxPlan | undefined = routed?.plan;
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
    // The plugins already brought the fresh data: no paid web search on top (unless the user asked for one).
    const searchWeb = () => Boolean(plan?.webSearch) && !(pluginText && !req.webSearch);
    const baseRequest = (m?: ModelInfo): ChatRequest =>
      m && plan
        ? {
            provider: m.provider,
            model: m.id,
            system: [
              maryxSystem(m, facts, {
                assistantPrompt: assistant?.systemPrompt,
                instructions: prefs.instructions,
                webSearch: searchWeb(),
              }),
              ...omitted,
              ...(researchText ? [researchText] : []),
              ...(councilText ? [councilText] : []),
              ...(pluginText ? [pluginText] : []),
            ].join("\n"),
            deepThinking: req.deepThinking,
            webSearch: searchWeb(),
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
    const firstHold = holdOf(firstCall);
    // Research's searches are paid on top (they're recorded as MARYX's own jobs).
    const extra = researching ? RESEARCH_HOLD_USD : consulting ? COUNCIL_HOLD_USD : 0;
    const refused = await reserve(
      bill,
      { expected: firstHold.expected + extra, most: firstHold.most + extra, least: firstHold.least + extra },
      { provider: firstCall.provider, model: firstCall.model },
    );
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
    let titleJob: Promise<string | null> | undefined = retitled ? Promise.resolve(retitled) : undefined;
    const firstText = userText.trim();
    const wantTitle = maryx && created && !chat.temporary && req.message !== undefined && (firstText.length > 40 || firstText.includes("\n"));
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

    // A long chat: MARYX retells the turns that no longer fit, for the next answers (after this one, off its path).
    if (retell) {
      const through = unretold[unretold.length - 1].seq;
      after(() =>
        answered
          ? summarizeChat(retold || null, unretold, meter)
              .then((summary) =>
                summary
                  ? db.update(schema.chat).set({ summary, summarySeq: through }).where(eq(schema.chat.id, chatId))
                  : undefined,
              )
              .catch((err) => console.error("[chat] summary failed", err))
          : undefined,
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
        let notices: string[] = [];
        const sources: Source[] = [];
        let error: string | undefined;
        /** What really went wrong, for admins. */
        let detail: string | undefined;

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
          if (researching) {
            const findings = await research(last.m.content, meter, (step) => send({ type: "progress", text: step }));
            const found = researchBrief(findings);
            researchText = found.brief;
            // The report cites these numbers; the browser lists them in the same order.
            for (const s of found.sources) {
              sources.push(s);
              send({ type: "source", url: s.url, title: s.title });
            }
          }
          if (plugins.length) {
            const before = loaded.slice(0, -1).findLast((l) => l.m.role === "user")?.m.content;
            const got = await pluginContext(last.m.content, before, plugins, meter, (step) => send({ type: "progress", text: step }));
            if (got) {
              pluginText = got.brief;
              for (const s of got.sources) {
                sources.push(s);
                send({ type: "source", url: s.url, title: s.title });
              }
            }
          }
          if (consulting) {
            const question = history[history.length - 1].content;
            const context = loaded
              .slice(-5, -1)
              .map((l) => `${l.m.role === "user" ? "Пользователь" : "MARYX"}: ${l.m.content.slice(0, 3000)}`)
              .join("\n\n");
            councilText = councilBrief(await council(question, context, meter, (step) => send({ type: "progress", text: step })));
          }
          for (let attempt = 0; ; ) {
            const current = candidates[attempt];
            if (plan) send({ type: "route", ...shown(provider, model), search: searchWeb() || undefined, retry: attempt > 0 || undefined });
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
            detail = errorDetail(err) + (failed.length > 1 ? ` (не ответили: ${failed.join(", ")})` : "");
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
            errorDetail: error ? (detail ?? null) : null,
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
function shown(provider: ProviderId, model: string, media?: MediaKind): { provider: ProviderId; model: string } {
  return maryxOnly() ? { provider: "maryx", model: media ? `maryx-${media}` : "maryx" } : { provider, model };
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

/** Images that can be edited (what the image models take). */
const EDITABLE = /^image\/(jpeg|png|webp)$/;

/**
 * The picture a follow-up edit is about: the one the last answer drew (or
 * edited), else the photo the last question was about. Null when the chat
 * has moved on (the last answer has no picture and its question no photo).
 */
async function pictureInFocus(chatId: string): Promise<InlineFile | null> {
  const rows = await chatMessages(chatId);
  const answer = rows[rows.length - 1];
  if (answer?.role !== "assistant") return null;
  const asked = rows[rows.length - 2];
  const file = [answer, asked].flatMap((m) => (m?.attachments ?? []).filter((f) => EDITABLE.test(f.mime)))[0];
  const data = file ? await readFileBase64(file.key) : null;
  return file && data ? { mime: file.mime, data, name: "Картинка для правки" } : null;
}

/** Whether the user's last message carries photos (drawing its answer again edits them). */
async function askedHasPhotos(chatId: string): Promise<boolean> {
  const asked = (await chatMessages(chatId)).findLast((m) => m.role === "user");
  return Boolean(asked?.attachments?.some((f) => f.mime.startsWith("image/")));
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

/** Video answers for vertical formats ("для сторис", "вертикальное") come out 9:16. */
const VERTICAL = /(вертикальн|сторис|stories|reels|рилс|тикток|tiktok|shorts|шортс)/i;

/**
 * Video mode: starts a clip from the last user message (with its photo as the
 * first frame) as a gallery item, and stores the answer pointing at it. The
 * clip is made in the background (also when the user leaves); the browser
 * follows the item until it's ready, here and in the video studio.
 */
function filmInChat(
  request: Request,
  user: SessionUser,
  bill: Charge,
  chatId: string,
  answerId: string,
  prompt: string,
  photos: InlineImage[],
  opts: { via?: "maryx"; camera?: string; attached?: Extract<ChatStreamEvent, { type: "attached" }>; until: number },
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The client went away; the answer is still saved below.
        }
      };
      const db = await getDb();
      let model: ModelInfo | undefined;
      let item: MediaItem | undefined;
      let text = "";
      let error: string | undefined;
      let detail: string | undefined;
      // Once the job is handed the charge, the gallery item settles (or refunds) it.
      let handed = false;
      if (opts.attached) send(opts.attached);
      try {
        const withPhoto = photos.length > 0;
        if (!withPhoto && !prompt.trim()) throw new Error("Опишите видео словами — или прикрепите фото, чтобы его оживить.");
        // Says what to set up when no model can make it.
        const first = await maryxMediaModel("video", Boolean(bill.key), withPhoto);
        const models = await maryxMediaModels("video", Boolean(bill.key), withPhoto);
        model = first;
        if (opts.via) send({ type: "route", ...shown(first.provider, first.id, "video"), video: true });
        const aspectRatio = withPhoto ? photoRatio(photos[0]) : VERTICAL.test(prompt) ? "9:16" : "16:9";
        handed = true;
        item = await startMediaJob(
          user,
          {
            kind: "video",
            provider: first.provider,
            model: first.id,
            prompt,
            aspectRatio,
            // The chat's clip starts from one photo (the studio also takes a last frame).
            ...(withPhoto ? { images: photos.slice(0, 1) } : {}),
            ...(opts.camera ? { camera: opts.camera } : {}),
          },
          bill,
          models.length ? models : [first],
          { until: opts.until, admin: isAdmin(user) },
        );
        send({ type: "media", item });
        if (item.status === "failed") error = item.error ?? "Не удалось снять видео. Попробуйте ещё раз.";
        else {
          text = withPhoto
            ? "Оживляю фото — это займёт 1–5 минут. Можно уйти со страницы: видео появится здесь и в разделе «Видео»."
            : "Снимаю видео — это займёт 1–5 минут. Можно уйти со страницы: видео появится здесь и в разделе «Видео».";
          send({ type: "text", text });
        }
      } catch (err) {
        // Nothing started: the charge goes back (the job refunds itself when it couldn't store the photo).
        if (!handed) await refundCharge(bill);
        console.error("[chat:video]", model?.provider, model?.id, err);
        error = describeAiError(err, model?.provider, Boolean(bill.key));
        detail = errorDetail(err);
      } finally {
        try {
          await db.insert(schema.message).values({
            id: answerId,
            chatId,
            role: "assistant",
            content: text,
            error: error ?? null,
            errorDetail: detail ?? null,
            mediaId: item?.id ?? null,
            provider: model?.provider ?? null,
            model: model?.id ?? null,
            via: opts.via ?? null,
          });
          await db.update(schema.chat).set({ updatedAt: new Date() }).where(eq(schema.chat.id, chatId));
        } catch (err) {
          console.error("[chat:video] failed to save the answer", err);
        }
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

/** The video shape closest to a photo's own (read from its JPEG, PNG or WebP header). */
function photoRatio(photo: InlineImage): AspectRatio {
  const size = imageSize(Buffer.from(photo.data.slice(0, 200_000), "base64"));
  return size && size.height > size.width ? "9:16" : "16:9";
}

function imageSize(b: Buffer): { width: number; height: number } | null {
  // PNG: the IHDR chunk comes first.
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // WebP (lossy "VP8 "): the frame size follows its start code.
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 12, 16) === "VP8 ") {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  // JPEG: the first start-of-frame marker holds it.
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
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
  attached?: Extract<ChatStreamEvent, { type: "attached" }>,
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
      let detail: string | undefined;
      let notice: string | undefined;
      // Which model made (or last tried) the picture, also when it fails.
      const tried: { model?: ModelInfo } = {};
      if (attached) send(attached);
      try {
        const editing = photos.length > 0;
        // A picture needs a description (an attached photo can be edited without one).
        if (!editing && !prompt.trim()) throw new Error("Опишите картинку словами — и MARYX её нарисует.");
        // Says what to set up when no model can draw (or edit photos).
        // The free plan draws with the free model (no fee); paid plans and credits with GPT Image.
        const free = freeLane(bill, "image");
        const picked = await chatImageModel(Boolean(bill.key), editing, { free });
        model = picked;
        if (via) send({ type: "route", ...shown(picked.provider, picked.id, "image"), image: true });
        const models = await maryxMediaModels("image", Boolean(bill.key), editing, { free });
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
          send({ type: "image", url: fileUrl(f.key), mime: f.mime, ...shown(made.provider, made.id, "image") });
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
          detail = errorDetail(err);
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
            errorDetail: detail ?? null,
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
