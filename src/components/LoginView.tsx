"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/client/auth";

interface Props {
  social: { google: boolean; vk: boolean };
}

/** Where to go after signing in: ?next=/path (same-site paths only). */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

const ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Неверная почта или пароль.",
  USER_ALREADY_EXISTS: "Аккаунт с этой почтой уже есть — войдите.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Аккаунт с этой почтой уже есть — войдите.",
  PASSWORD_TOO_SHORT: "Пароль должен быть не короче 8 символов.",
  INVALID_EMAIL: "Проверьте адрес почты.",
};

/** A crash on the server says nothing useful by itself; point the owner at the setup check. */
function serverError(status: number | undefined): string | null {
  return status !== undefined && status >= 500
    ? "Ошибка на сервере. Если вы владелец сайта, откройте /api/health — там видно, что не настроено."
    : null;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.9l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  );
}

export function LoginView({ social }: Props) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === "signup"
        ? await authClient.signUp.email({ name: name.trim() || email.split("@")[0], email, password })
        : await authClient.signIn.email({ email, password });
    if (result.error) {
      setError(ERRORS[result.error.code ?? ""] ?? serverError(result.error.status) ?? result.error.message ?? "Не удалось войти.");
      setBusy(false);
      return;
    }
    // Full reload so every part of the app starts with the new session.
    window.location.assign(nextPath());
  };

  const socialSignIn = async (provider: "google" | "vk") => {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.social({ provider, callbackURL: nextPath() });
    if (result.error) {
      setError(serverError(result.error.status) ?? result.error.message ?? "Не удалось войти.");
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-400/60";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/30">
            <Sparkles className="size-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-zinc-100">
            {mode === "signin" ? "Вход в Nexus AI" : "Регистрация"}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Claude, GPT, Gemini и другие модели в одном месте
          </p>
        </div>

        {(social.google || social.vk) && (
          <div className="mb-5 space-y-2">
            {social.google && (
              <button
                type="button"
                disabled={busy}
                onClick={() => socialSignIn("google")}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm text-zinc-100 transition hover:bg-white/10 disabled:opacity-50"
              >
                <GoogleIcon /> Продолжить с Google
              </button>
            )}
            {social.vk && (
              <button
                type="button"
                disabled={busy}
                onClick={() => socialSignIn("vk")}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0077FF] py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
              >
                <span className="font-bold">VK</span> Продолжить с VK ID
              </button>
            )}
            <div className="flex items-center gap-3 pt-2 text-xs text-zinc-600">
              <div className="h-px flex-1 bg-white/10" /> или по почте <div className="h-px flex-1 bg-white/10" />
            </div>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как вас зовут"
              autoComplete="name"
              className={field}
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Почта"
            autoComplete="email"
            className={field}
          />
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "Пароль (от 8 символов)" : "Пароль"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={field}
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-50"
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {mode === "signin" ? "Войти" : "Создать аккаунт"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-400">
          {mode === "signin" ? "Нет аккаунта?" : "Уже есть аккаунт?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
            }}
            className="font-medium text-violet-300 hover:text-violet-200"
          >
            {mode === "signin" ? "Зарегистрироваться" : "Войти"}
          </button>
        </p>
      </div>
    </div>
  );
}
