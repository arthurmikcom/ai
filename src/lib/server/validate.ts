import { PROVIDERS } from "@/lib/catalog";
import { CAMERA_MOTIONS, IMAGE_STYLES, VIDEO_EFFECTS } from "@/lib/effects";
import type { AspectRatio, ChatSendRequest, GenerateRequest, InlineFile, InlineImage, ProviderId } from "@/lib/types";
import { maryxOnly } from "./config";
import { isDocumentMime } from "./documents";
import { isValidId } from "./http";
import { MOTION_MAX_SECONDS, MOTION_MIN_SECONDS } from "./media/higgsfield";
import { isValidKey } from "./storage";

const PROVIDER_IDS = new Set<string>([...PROVIDERS.map((p) => p.id), "maryx", "browser"]);
const ASPECT_RATIOS = new Set<string>(["1:1", "16:9", "9:16", "4:3", "3:4"]);
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_ATTACHMENTS = 4;
// ~3 MB of bytes per file; the browser shrinks images well below this.
const MAX_ATTACHMENT_BASE64 = 4_000_000;
// Vercel refuses request bodies over 4.5 MB, so all files together stay under it.
const MAX_TOTAL_BASE64 = 4_300_000;

export function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_IDS.has(value);
}

/** Refusal of another model in MARYX-only mode (a tab opened before the switch still offers them). */
export const ONLY_MARYX = "Доступен только MARYX — обновите страницу";

/** A provider a user may pick for a chat or an assistant: only MARYX in MARYX-only mode. */
export function isSelectable(value: unknown): value is ProviderId {
  return isProvider(value) && (!maryxOnly() || value === "maryx");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Returns the parsed request, or an error message for the client. */
export function parseChatSendRequest(body: unknown): ChatSendRequest | string {
  if (!isObject(body)) return "Пустой запрос";
  const { chatId, create, deepThinking, image, video, camera, style, webSearch, research, council, message, answerId, replyTo, replace } = body;
  // Tabs opened before the rename to MARYX still say "nexus".
  const provider = body.provider === "nexus" ? "maryx" : body.provider;
  const model = body.model === "nexus" ? "maryx" : body.model;
  if (!isValidId(chatId) || !isValidId(answerId)) return "Неверный идентификатор";
  if (replyTo !== undefined && !isValidId(replyTo)) return "Неверный идентификатор";
  if (replace !== undefined && (!isValidId(replace) || message === undefined)) return "Неверный идентификатор";
  if (!isProvider(provider)) return "Неизвестный провайдер";
  // Browser models answer on the visitor's device and save through /api/chat/local.
  if (provider === "browser") return "Эта модель работает в браузере — обновите страницу";
  if (typeof model !== "string" || !model || model.length > 200) return "Не выбрана модель";
  if (maryxOnly() && (provider !== "maryx" || model !== "maryx")) return ONLY_MARYX;

  if (image === true && video === true) return "Выберите что-то одно: картинку или видео";
  if (camera !== undefined && (video !== true || !CAMERA_MOTIONS.some((m) => m.id === camera))) return "Неизвестное движение камеры";
  if (style !== undefined && (image !== true || !IMAGE_STYLES.some((s) => s.id === style))) return "Неизвестный стиль";

  let assistantId: string | undefined;
  if (create !== undefined) {
    if (!isObject(create)) return "Неверный запрос";
    if (create.assistantId !== undefined && !isValidId(create.assistantId)) return "Неверный ассистент";
    assistantId = create.assistantId as string | undefined;
    if (create.temporary !== undefined && typeof create.temporary !== "boolean") return "Неверный запрос";
  }

  let parsedMessage: ChatSendRequest["message"];
  if (message !== undefined) {
    if (!isObject(message) || !isValidId(message.id) || typeof message.content !== "string") {
      return "Неверный формат сообщения";
    }
    if (message.content.length > 100_000) return "Сообщение слишком длинное";
    const attachments = message.attachments ?? [];
    if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) {
      return "Слишком много вложений";
    }
    let total = 0;
    for (const a of attachments) {
      if (!isObject(a) || typeof a.mime !== "string") return "Неверное вложение";
      if (a.hidden !== undefined && (a.hidden !== true || !IMAGE_MIME.has(a.mime))) return "Неверное вложение";
      // A whole video, uploaded beforehand in parts: only its key comes (the route checks it's the user's).
      if (a.key !== undefined) {
        if (typeof a.key !== "string" || !VIDEO_MIME.has(a.mime) || (a.data !== undefined && a.data !== "")) return "Неверное вложение";
        if (a.name !== undefined && (typeof a.name !== "string" || a.name.length > 200)) return "Неверное имя файла";
        continue;
      }
      if (typeof a.data !== "string") return "Неверное вложение";
      if (!IMAGE_MIME.has(a.mime) && !isDocumentMime(a.mime)) {
        return "Можно прикреплять изображения (JPEG, PNG, GIF, WebP) и документы (PDF, Word, Excel, CSV, TXT)";
      }
      if (a.name !== undefined && (typeof a.name !== "string" || a.name.length > 200)) return "Неверное имя файла";
      if (a.data.length > MAX_ATTACHMENT_BASE64) return "Файл слишком большой: до 3 МБ";
      total += a.data.length;
    }
    if (total > MAX_TOTAL_BASE64) return "Вложения слишком большие: всего до 3 МБ за сообщение";
    if (!message.content.trim() && attachments.length === 0) return "Пустое сообщение";
    parsedMessage = {
      id: message.id,
      content: message.content,
      attachments: attachments.length
        ? (attachments as InlineFile[]).map((a) => ({
            mime: a.mime,
            data: a.key ? "" : a.data,
            name: a.name,
            ...(a.key ? { key: a.key } : {}),
            ...(a.hidden ? { hidden: true } : {}),
          }))
        : undefined,
    };
  }

  return {
    chatId,
    create: create === undefined ? undefined : { assistantId, ...(isObject(create) && create.temporary === true ? { temporary: true } : {}) },
    provider,
    model,
    deepThinking: deepThinking === true,
    image: image === true,
    video: video === true,
    ...(typeof camera === "string" ? { camera } : {}),
    ...(typeof style === "string" ? { style } : {}),
    webSearch: webSearch === true,
    research: research === true,
    council: council === true,
    replyTo: replyTo as string | undefined,
    ...(typeof replace === "string" ? { replace } : {}),
    message: parsedMessage,
    answerId,
  };
}

/** Photos to edit: what the image models take (the browser sends JPEG). */
const PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Whether base64 data starts like the image type it claims to be. */
function looksLike(mime: string, data: string): boolean {
  const head = Buffer.from(data.slice(0, 24), "base64");
  if (mime === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === "image/png") return head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === "image/webp") return head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
  return false;
}

function parsePhotos(value: unknown): InlineImage[] | string {
  if (!Array.isArray(value) || value.length === 0) return "Неверный формат фото";
  if (value.length > MAX_ATTACHMENTS) return `Не больше ${MAX_ATTACHMENTS} фото за раз`;
  let total = 0;
  const photos: InlineImage[] = [];
  for (const p of value) {
    if (!isObject(p) || typeof p.mime !== "string" || typeof p.data !== "string") return "Неверный формат фото";
    if (!PHOTO_MIME.has(p.mime)) return "Можно загрузить фото в формате JPEG, PNG или WebP";
    if (p.data.length > MAX_ATTACHMENT_BASE64) return "Фото слишком большое: до 3 МБ";
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(p.data) || !looksLike(p.mime, p.data)) return "Не удалось прочитать фото — сохраните его как JPEG или PNG";
    total += p.data.length;
    photos.push({ mime: p.mime, data: p.data });
  }
  if (total > MAX_TOTAL_BASE64) return "Фото слишком большие: всего до 3 МБ за раз";
  return photos;
}

export function parseGenerateRequest(body: unknown): GenerateRequest | string {
  if (!isObject(body)) return "Пустой запрос";
  const { kind, provider, model, prompt, aspectRatio, images, camera, effect, duration, style, character, recast, consent, cast, motion } = body;
  if (kind !== "image" && kind !== "video") return "Неизвестный тип генерации";
  if (!isProvider(provider) || provider === "browser") return "Неизвестный провайдер";
  if (maryxOnly() && provider !== "maryx") return ONLY_MARYX;
  if (typeof model !== "string" || !model || model.length > 200) return "Не выбрана модель";
  const photos = images === undefined ? undefined : parsePhotos(images);
  if (typeof photos === "string") return photos;
  if (photos && kind === "video" && photos.length > 2 && motion === undefined) return "Для видео — одно фото (первый кадр) или два (первый и последний)";
  // A photo can be edited without words (a natural retouch); a new picture needs a description.
  if (typeof prompt !== "string" || (!prompt.trim() && !photos)) return "Опишите, что нужно сгенерировать";
  if (prompt.length > 4000) return "Описание слишком длинное: до 4000 символов";
  if (typeof aspectRatio !== "string" || !ASPECT_RATIOS.has(aspectRatio)) return "Неверное соотношение сторон";
  if (camera !== undefined && (kind !== "video" || !CAMERA_MOTIONS.some((m) => m.id === camera))) return "Неизвестное движение камеры";
  if (effect !== undefined && (kind !== "video" || !VIDEO_EFFECTS.some((e) => e.id === effect))) return "Неизвестный эффект";
  if (duration !== undefined && (kind !== "video" || !Number.isInteger(duration) || (duration as number) < 2 || (duration as number) > 20)) {
    return "Длительность видео — от 2 до 20 секунд";
  }
  if (style !== undefined && (kind !== "image" || !IMAGE_STYLES.some((s) => s.id === style))) return "Неизвестный стиль";
  // Several people of a trend recast at once: who becomes whom (a saved character, or the next photo).
  let roles: { who: string; character?: string }[] | undefined;
  if (cast !== undefined) {
    if ((recast !== true && motion === undefined) || character !== undefined || !Array.isArray(cast) || cast.length < 1 || cast.length > 3) {
      return "Неверный выбор персонажей";
    }
    roles = [];
    for (const role of cast as unknown[]) {
      if (!isObject(role) || typeof role.who !== "string" || !role.who.trim() || role.who.length > 120) return "Неверный выбор персонажей";
      if (role.character !== undefined && (typeof role.character !== "string" || !isValidId(role.character))) return "Неизвестный персонаж";
      roles.push({ who: role.who.trim(), ...(typeof role.character === "string" ? { character: role.character } : {}) });
    }
  }
  if (recast !== undefined) {
    // A frame of a video, and who takes the people's places: saved characters or photos after the frame.
    const needed = roles ? 1 + roles.filter((r) => !r.character).length : character === undefined ? 2 : 1;
    if (recast !== true || kind !== "image" || !photos || photos.length !== needed) return "Нужен кадр из видео и фото персонажа";
    if (consent !== true) return "Подтвердите, что на фото вы или человек, который разрешил использовать своё лицо";
  }
  // «Тренд», move for move: the uploaded trend video, and a photo for each new person who isn't a saved character.
  let move: { key: string; seconds: number } | undefined;
  if (motion !== undefined) {
    if (!isObject(motion) || typeof motion.key !== "string" || !isValidKey(motion.key) || !/\.mp4$/.test(motion.key)) return "Нужно видео тренда в формате MP4";
    if (typeof motion.seconds !== "number" || !Number.isFinite(motion.seconds)) return "Неверная длина тренда";
    if (kind !== "video" || recast !== undefined || character !== undefined || !roles) return "Неверный запрос тренда";
    if (motion.seconds < MOTION_MIN_SECONDS) return `Тренд слишком короткий: нужно хотя бы ${MOTION_MIN_SECONDS} секунды`;
    if ((photos?.length ?? 0) !== roles.filter((r) => !r.character).length) return "Нужно фото для каждого героя";
    if (consent !== true) return "Подтвердите, что на фото вы или человек, который разрешил использовать своё лицо";
    move = { key: motion.key, seconds: Math.min(MOTION_MAX_SECONDS, motion.seconds) };
  }
  if (character !== undefined && (kind !== "image" || (photos && recast !== true) || typeof character !== "string" || !isValidId(character))) return "Неизвестный персонаж";
  if (character !== undefined && !recast && !prompt.trim()) return "Опишите сцену: где и кем нарисовать персонажа";
  return {
    kind,
    provider,
    model,
    prompt: prompt.trim(),
    aspectRatio: aspectRatio as AspectRatio,
    ...(photos ? { images: photos } : {}),
    ...(typeof camera === "string" ? { camera } : {}),
    ...(typeof effect === "string" ? { effect } : {}),
    ...(typeof duration === "number" ? { duration } : {}),
    ...(typeof style === "string" ? { style } : {}),
    ...(typeof character === "string" ? { character } : {}),
    ...(recast === true ? { recast: true, consent: true } : {}),
    ...(roles ? { cast: roles } : {}),
    ...(move ? { motion: move, consent: true } : {}),
  };
}

/** A new character («Мой персонаж»): a name and 1–3 photos of the person. */
export function parseCharacter(body: unknown, maxPhotos: number): { name: string; photos: InlineImage[] } | string {
  if (!isObject(body)) return "Пустой запрос";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return "Назовите персонажа";
  if (name.length > 40) return "Имя слишком длинное: до 40 символов";
  const photos = parsePhotos(body.photos);
  if (typeof photos === "string") return photos === "Неверный формат фото" ? "Добавьте хотя бы одно фото" : photos;
  if (photos.length > maxPhotos) return `Достаточно ${maxPhotos} фото: лицо крупно, с разных сторон`;
  return { name, photos };
}
