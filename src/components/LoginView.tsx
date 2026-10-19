"use client";

import { ArrowUpRight, LoaderCircle, LockKeyhole, Sparkles } from "@/components/MaryxIcons";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/client/auth";
import { LegalLinks } from "./LegalPage";
import { BrandMark, BrandName } from "./Design";
import { StudioImage } from "./WorkspaceVisuals";

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
    "login-input w-full text-sm text-zinc-100 outline-none placeholder:text-zinc-600";

  return (
    <div className="login-page">
      <aside className="login-story">
        <div className="flex items-center gap-3">
          <BrandMark />
          <BrandName />
        </div>
        <div className="my-6 md:my-10">
          <div className="section-label mb-5 hidden md:block">Интеллект без границ</div>
          <h2>Большие идеи.<br /><em>Новые возможности.</em></h2>
          <p className="mt-5 hidden max-w-sm text-sm leading-7 text-zinc-400 md:block">
            Ваш собственный ИИ, ваши мысли и пространство, где из них рождается что-то большее.
          </p>
        </div>
        <StudioImage className="login-visual-art" preload />
        <div className="hidden items-end justify-between gap-5 border-t border-white/10 pt-5 md:flex">
          <div>
            <p className="text-xs text-zinc-300">Одно пространство. Много возможностей.</p>
            <p className="mt-2 text-[11px] text-zinc-500">Диалоги · Изображения · Видео · Ассистенты</p>
          </div>
          <Sparkles className="size-5 shrink-0 text-violet-300" aria-hidden="true" />
        </div>
      </aside>
      <div className="login-form-side">
      <div className="relative w-full max-w-[360px]">
        <div className="mb-8">
          <div className="page-eyebrow"><span>01</span>Ваше пространство</div>
          <h1 className="text-[30px] font-medium tracking-[-0.04em] text-zinc-100">
            {mode === "signin" ? "Вход в MARYX Ai" : "Регистрация"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            {mode === "signin" ? "Хорошие идеи начинаются с диалога. Продолжим?" : "Создайте аккаунт — и дайте идеям больше свободы."}
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
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0077FF] py-2.5 text-sm font-medium text-[#fff] transition hover:brightness-110 disabled:opacity-50"
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
              aria-label="Как вас зовут"
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
            aria-label="Почта"
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
            aria-label="Пароль"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={field}
          />
          {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="maryx-button mt-2 flex h-[52px] w-full items-center justify-center gap-3 rounded-xl text-sm"
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {mode === "signin" ? "Войти" : "Создать аккаунт"}
            {!busy && <ArrowUpRight className="size-4" aria-hidden="true" />}
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
        <div className="mt-8 flex items-center justify-center gap-2 border-t border-white/5 pt-6 text-[11px] text-zinc-500">
          <LockKeyhole className="size-3.5" aria-hidden="true" />
          Ваши диалоги доступны только вам
        </div>
        <LegalLinks className="mt-3" />
      </div>
      </div>
    </div>
  );
}
