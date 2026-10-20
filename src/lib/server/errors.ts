import type { ProviderId } from "@/lib/types";
import { NotConfiguredError } from "./config";

/** Error raised by our own REST calls (Replicate, media downloads). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** More of the provider's answer (e.g. the upstream provider's own error), for logs and admins. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

/**
 * No file storage to keep a photo, video or document in: on Vercel the site's
 * own disk is read-only, so it needs a Vercel Blob store connected to the project.
 */
export class StorageUnavailableError extends Error {
  constructor() {
    super("Фото, видео и файлы пока нельзя сохранить: на сайте не подключено хранилище файлов. Напишите текстом или попробуйте позже.");
  }
}

export function statusOf(err: unknown): number | undefined {
  // The Anthropic, OpenAI and Google SDK errors all expose a numeric `status`.
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * Turns any provider error into a short message for the user (in Russian).
 * `ownKey`: the request went out with the user's own OpenRouter key, so key
 * and balance problems are theirs to fix, not the site's.
 */
export function describeError(err: unknown, provider?: ProviderId, ownKey = false): string {
  if (err instanceof NotConfiguredError || err instanceof StorageUnavailableError) return err.message;

  const detail = err instanceof Error ? err.message : String(err);
  const status = statusOf(err);
  if (ownKey && provider === "openrouter") {
    if (status === 401) {
      return "OpenRouter не принял ваш ключ: возможно, он удалён или отключён. Проверьте ключ в настройках или удалите его, чтобы пользоваться тарифом сайта.";
    }
    // 403: the model's moderation flagged the input, or the key hit its own spending limit.
    if (status === 403) {
      return `OpenRouter отклонил запрос: ${detail}. Если дело в модерации — переформулируйте запрос или выберите другую модель.`;
    }
    if (status === 402) {
      return "На вашем ключе OpenRouter закончились деньги или исчерпан его лимит. Пополните баланс на openrouter.ai/credits или удалите ключ в настройках, чтобы пользоваться тарифом сайта.";
    }
  }
  switch (status) {
    case 400:
      return `Провайдер отклонил запрос: ${detail}`;
    case 401:
    case 403:
      if (provider === "qwen") {
        return "Alibaba Cloud не принял ключ. Ключи привязаны к региону: проверьте DASHSCOPE_API_KEY и DASHSCOPE_BASE_URL.";
      }
      return "Неверный API-ключ или нет доступа к этой модели. Проверьте ключ в переменных окружения (на Vercel: Settings → Environment Variables).";
    case 402:
      return "На счёте провайдера закончились средства.";
    case 404:
      return "Модель не найдена: возможно, она снята с поддержки или недоступна для вашего ключа.";
    case 413:
      return "Запрос слишком большой: уменьшите вложения или начните новый чат.";
    case 422:
      return `Модель не приняла параметры запроса: ${detail}`;
    case 429:
      return "Превышен лимит запросов или исчерпана квота. Подождите немного или проверьте баланс.";
    case 500:
    case 502:
    case 503:
    case 529:
      return "Провайдер сейчас перегружен или недоступен. Попробуйте ещё раз через минуту.";
    default:
      return detail || "Неизвестная ошибка";
  }
}

/**
 * A failure as admins see it (never sent to users): the status and the
 * provider's own words, with anything that looks like a key cut out.
 */
export function errorDetail(err: unknown): string {
  const status = statusOf(err);
  const message = err instanceof Error ? err.message : String(err);
  const more = err instanceof HttpError && err.detail && !message.includes(err.detail) ? ` — ${err.detail}` : "";
  const text = `${message}${more}`
    .replace(/\b(sk|rk|pk|r8)([-_][A-Za-z0-9]+)?[-_][A-Za-z0-9_-]{12,}/g, "$1-…")
    .replace(/\s+/g, " ")
    .trim();
  return (status && !text.startsWith(String(status)) ? `${status} ${text}` : text).slice(0, 500);
}
