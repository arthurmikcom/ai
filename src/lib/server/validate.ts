import { PROVIDERS } from "@/lib/catalog";
import type { AspectRatio, ChatRequest, GenerateRequest, ProviderId } from "@/lib/types";

const PROVIDER_IDS = new Set<string>(PROVIDERS.map((p) => p.id));
const ASPECT_RATIOS = new Set<string>(["1:1", "16:9", "9:16", "4:3", "3:4"]);
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_ATTACHMENTS = 8;

export function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_IDS.has(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Returns the parsed request, or an error message for the client. */
export function parseChatRequest(body: unknown): ChatRequest | string {
  if (!isObject(body)) return "Пустой запрос";
  const { provider, model, system, deepThinking, messages } = body;
  if (!isProvider(provider)) return "Неизвестный провайдер";
  if (typeof model !== "string" || !model) return "Не выбрана модель";
  if (system !== undefined && typeof system !== "string") return "Неверный system prompt";
  if (!Array.isArray(messages) || messages.length === 0) return "Нет сообщений";

  const parsed: ChatRequest["messages"] = [];
  for (const m of messages) {
    if (!isObject(m) || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return "Неверный формат сообщения";
    }
    const attachments = m.attachments ?? [];
    if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) {
      return "Слишком много вложений";
    }
    for (const a of attachments) {
      if (!isObject(a) || typeof a.data !== "string" || typeof a.mime !== "string" || !IMAGE_MIME.has(a.mime)) {
        return "Поддерживаются только изображения JPEG, PNG, GIF и WebP";
      }
    }
    parsed.push({
      role: m.role,
      content: m.content,
      attachments: attachments.length ? (attachments as ChatRequest["messages"][number]["attachments"]) : undefined,
    });
  }
  if (parsed[0].role !== "user") return "Диалог должен начинаться с сообщения пользователя";

  return { provider, model, system: system || undefined, deepThinking: deepThinking === true, messages: parsed };
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
