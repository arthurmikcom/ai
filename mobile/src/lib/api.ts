import { fetch as streamingFetch } from "expo/fetch";
import { sessionCookie } from "./auth";
import { siteUrl } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** "login" — a guest asked for what needs an account; "limit" — a daily limit. */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Headers of an API request: JSON, and the session on a phone. */
export async function apiHeaders(json = true): Promise<Record<string, string>> {
  const cookie = await sessionCookie();
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) };
}

/** The error an API route answered with ({ error, code }). */
export async function errorOf(res: { status: number; json(): Promise<unknown> }): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  return new ApiError(res.status, body?.error ?? `Ошибка сервера (${res.status})`, body?.code);
}

/** A JSON request to the site's API. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(siteUrl(path), {
      method: init.method ?? "GET",
      headers: await apiHeaders(init.body !== undefined),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет.");
  }
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

/** A request whose answer is read as it arrives, one JSON object per line (the chat). */
export async function* streamLines<T>(path: string, body: unknown, signal: AbortSignal): AsyncGenerator<T> {
  let res: Awaited<ReturnType<typeof streamingFetch>>;
  try {
    res = await streamingFetch(siteUrl(path), {
      method: "POST",
      headers: await apiHeaders(),
      body: JSON.stringify(body),
      signal,
      credentials: "include",
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет.");
  }
  if (!res.ok) throw await errorOf(res);
  const reader = res.body?.getReader();
  if (!reader) throw new ApiError(0, "Ответ не пришёл — попробуйте ещё раз.");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let i; (i = buffer.indexOf("\n")) >= 0; ) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest) as T;
}

/** An id the server accepts (8–64 letters, digits, - and _). */
export function uid(): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
