import type { ProviderId } from "@/lib/types";
import { NotConfiguredError } from "./config";

/** Error raised by our own REST calls (Replicate, media downloads). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
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
  if (err instanceof NotConfiguredError) return err.message;

  const detail = err instanceof Error ? err.message : String(err);
  const status = statusOf(err);
  if (ownKey && provider === "openrouter") {
    if (status === 401 || status === 403) {
      return "OpenRouter не принял ваш ключ: возможно, он удалён или отключён. Проверьте ключ в настройках или удалите его, чтобы пользоваться тарифом сайта.";
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
