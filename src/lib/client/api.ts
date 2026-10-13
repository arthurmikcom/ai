"use client";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Reads the error message our API routes return as { error }. */
export async function errorOf(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 401) goToLogin();
  return new ApiError(res.status, body?.error ?? `Ошибка сервера (${res.status})`);
}

/** The session ended (expired or signed out elsewhere). */
export function goToLogin() {
  if (window.location.pathname !== "/login") {
    // Full reload: drop the previous session's data from memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}
