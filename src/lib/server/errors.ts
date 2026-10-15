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

/** Turns any provider error into a short message for the user (in Russian). */
export function describeError(err: unknown): string {
  if (err instanceof NotConfiguredError) return err.message;

  const detail = err instanceof Error ? err.message : String(err);
  switch (statusOf(err)) {
    case 400:
      return `Провайдер отклонил запрос: ${detail}`;
    case 401:
    case 403:
      return "Неверный API-ключ или нет доступа к этой модели. Проверьте ключ в .env.local.";
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
