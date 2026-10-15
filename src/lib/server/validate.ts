import { PROVIDERS } from "@/lib/catalog";
import type { AspectRatio, ChatSendRequest, GenerateRequest, InlineImage, ProviderId } from "@/lib/types";
import { isValidId } from "./http";

const PROVIDER_IDS = new Set<string>(PROVIDERS.map((p) => p.id));
const ASPECT_RATIOS = new Set<string>(["1:1", "16:9", "9:16", "4:3", "3:4"]);
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_ATTACHMENTS = 4;
// ~3 MB of image bytes; the browser shrinks images well below this.
const MAX_ATTACHMENT_BASE64 = 4_000_000;

export function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_IDS.has(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Returns the parsed request, or an error message for the client. */
export function parseChatSendRequest(body: unknown): ChatSendRequest | string {
  if (!isObject(body)) return "Пустой запрос";
  const { chatId, create, provider, model, deepThinking, image, webSearch, message, answerId } = body;
  if (!isValidId(chatId) || !isValidId(answerId)) return "Неверный идентификатор";
  if (!isProvider(provider)) return "Неизвестный провайдер";
  if (typeof model !== "string" || !model || model.length > 200) return "Не выбрана модель";

  let assistantId: string | undefined;
  if (create !== undefined) {
    if (!isObject(create)) return "Неверный запрос";
    if (create.assistantId !== undefined && !isValidId(create.assistantId)) return "Неверный ассистент";
    assistantId = create.assistantId as string | undefined;
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
    for (const a of attachments) {
      if (!isObject(a) || typeof a.data !== "string" || typeof a.mime !== "string" || !IMAGE_MIME.has(a.mime)) {
        return "Поддерживаются только изображения JPEG, PNG, GIF и WebP";
      }
      if (a.data.length > MAX_ATTACHMENT_BASE64) return "Изображение слишком большое";
    }
    if (!message.content.trim() && attachments.length === 0) return "Пустое сообщение";
    parsedMessage = {
      id: message.id,
      content: message.content,
      attachments: attachments.length ? (attachments as InlineImage[]) : undefined,
    };
  }

  return {
    chatId,
    create: create === undefined ? undefined : { assistantId },
    provider,
    model,
    deepThinking: deepThinking === true,
    image: image === true,
    webSearch: webSearch === true,
    message: parsedMessage,
    answerId,
  };
}

export function parseGenerateRequest(body: unknown): GenerateRequest | string {
  if (!isObject(body)) return "Пустой запрос";
  const { kind, provider, model, prompt, aspectRatio } = body;
  if (kind !== "image" && kind !== "video") return "Неизвестный тип генерации";
  if (!isProvider(provider)) return "Неизвестный провайдер";
  if (typeof model !== "string" || !model) return "Не выбрана модель";
  if (typeof prompt !== "string" || !prompt.trim()) return "Опишите, что нужно сгенерировать";
  if (typeof aspectRatio !== "string" || !ASPECT_RATIOS.has(aspectRatio)) return "Неверное соотношение сторон";
  return { kind, provider, model, prompt: prompt.trim(), aspectRatio: aspectRatio as AspectRatio };
}
