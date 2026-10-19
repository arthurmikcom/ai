// MARYX-only mode (see maryxOnly): what users see of the models behind MARYX.
// The real provider and model stay in the database (routing, costs, admin
// screens); only what is sent to the browser is masked here.

import { FEATURED_MODELS } from "@/lib/catalog";
import type { ProviderId } from "@/lib/types";
import { maryxOnly, NotConfiguredError } from "./config";
import { describeError, statusOf } from "./errors";

export { maryxOnly };

/** Names of the models, companies and services behind MARYX, and their setup. */
const VENDOR =
  /openrouter|anthropic|claude|openai|chatgpt|\bgpt|gemini|google|alibaba|dashscope|qwen|deepseek|\bxai\b|grok|replicate|mistral|llama|\bmeta\b|flux|\bveo\b|kling|seedance|hailuo|\bwan\b|imagen|banana|ideogram|recraft|seedream|ollama|vllm|_api_key|_api_token|провайдер/i;

/** Whether a text names what is behind MARYX. */
export function namesVendor(text: string): boolean {
  return VENDOR.test(text);
}

const FAILED = "MARYX сейчас не смог выполнить запрос. Попробуйте ещё раз через минуту.";

/** Our own messages are in Russian and name no provider; a provider's raw text is neither. */
function ours(text: string): boolean {
  return /[а-яё]/i.test(text) && !namesVendor(text);
}

/** A stored or reported error, as users see it: our own texts stay, a provider's don't. */
export function publicError(text: string): string {
  if (!maryxOnly()) return text;
  if (/^Модель (не вернула изображение|ничего не вернула)/.test(text)) {
    return "MARYX не смог создать изображение — попробуйте переформулировать запрос.";
  }
  return ours(text) ? text : FAILED;
}

/**
 * A notice on an answer, as users see it, or undefined to drop it: which model
 * stood in for which is MARYX's own business.
 */
export function publicNotice(text: string): string | undefined {
  if (!maryxOnly()) return text;
  if (/сейчас не отвечает — отвечает|^Не ответила ни одна из моделей|отклонила запрос — ответ продолжила/.test(text)) return undefined;
  if (/фильтром безопасности/.test(text)) return "Ответ остановлен фильтром безопасности.";
  if (/^Модель отказалась/.test(text)) return "MARYX не стал отвечать на этот запрос.";
  return namesVendor(text) ? undefined : text;
}

/** Notices joined as stored (one per line), cleaned for users. */
export function publicNotices(stored: string): string | undefined {
  const kept = stored.split("\n").flatMap((line) => publicNotice(line) ?? []);
  return kept.length ? kept.join("\n") : undefined;
}

/**
 * A provider error as users see it. In MARYX-only mode it names no provider
 * and gives no raw upstream detail (that goes to the server log).
 */
export function describeAiError(err: unknown, provider?: ProviderId, ownKey = false): string {
  if (!maryxOnly()) return describeError(err, provider, ownKey);
  if (err instanceof NotConfiguredError) return "MARYX временно недоступен. Попробуйте позже.";
  if (/PrivacyInformation|may contain real person/i.test(`${(err as { message?: string })?.message ?? ""} ${(err as { detail?: string })?.detail ?? ""}`)) {
    return "Видеомодель не приняла фото с реальным человеком. Попробуйте ещё раз — MARYX возьмёт другую модель.";
  }
  switch (statusOf(err)) {
    case 400:
    case 422:
      return "MARYX не смог обработать этот запрос — переформулируйте его или уберите вложения.";
    case 403:
      return "MARYX не может выполнить этот запрос — переформулируйте его.";
    case 401:
    case 402:
    case 404:
      return "MARYX временно недоступен — мы уже разбираемся. Попробуйте позже.";
    case 413:
      return "Запрос слишком большой: уменьшите вложения или начните новый чат.";
    case 429:
      return "MARYX сейчас перегружен запросами. Подождите немного и попробуйте снова.";
    case 500:
    case 502:
    case 503:
    case 529:
      return "MARYX сейчас перегружен. Попробуйте ещё раз через минуту.";
    default:
      // Our own messages (e.g. "Картинка рисуется слишком долго") stay.
      return publicError(err instanceof Error ? err.message : String(err));
  }
}

/** Image models of the catalog, to tell drawings apart from answers in stored chats. */
const IMAGE_IDS = new Set(FEATURED_MODELS.filter((m) => m.capability === "image").map((m) => `${m.provider}:${m.id}`));

/** Whether an answer was drawn by an image model (its stored provider and model). */
export function isImageModel(provider: string | null | undefined, model: string | null | undefined): boolean {
  if (!provider || !model) return false;
  return IMAGE_IDS.has(`${provider}:${model}`) || /image|flux|imagen|dall-e|seedream|riverflow|recraft|ideogram|banana/i.test(model);
}
