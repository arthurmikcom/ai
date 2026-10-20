"use client";

import { ArrowUpRight, CircleCheck, LoaderCircle, TriangleAlert } from "@/components/MaryxIcons";
import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { authClient } from "@/lib/client/auth";
import { BrandMark, BrandName } from "./Design";

const noSubscribe = () => () => {};

/** The link's token, or "" when it's missing or the link has expired (better-auth adds ?error=INVALID_TOKEN). */
function tokenOf(search: string): string {
  const query = new URLSearchParams(search);
  return query.get("error") ? "" : (query.get("token") ?? "");
}

/**
 * The page the «Забыли пароль?» letter links to: a new password, twice. Setting
 * it signs out every device, so whoever knew the old one is out too.
 */
export function ResetPasswordView() {
  // null while prerendered (no URL yet).
  const token = useSyncExternalStore(noSubscribe, () => tokenOf(window.location.search), () => null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password !== repeat) {
      setError("Пароли не совпадают.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (!result.error) {
      setDone(true);
    } else if (result.error.code === "INVALID_TOKEN") {
      setExpired(true);
    } else {
      setError(
        result.error.code === "PASSWORD_TOO_SHORT"
          ? "Пароль должен быть не короче 8 символов."
          : result.error.status === 429
            ? "Слишком много попыток — подождите минуту."
            : "Не удалось сменить пароль. Попробуйте ещё раз.",
      );
    }
  };

  const field = "login-input w-full text-sm text-zinc-100 outline-none placeholder:text-zinc-600";
  const bad = token === "" || expired;

  return (
    <div className="pay-page">
      <div className="pay-card surface-card" aria-live="polite">
        <div className="mb-2 flex items-center gap-3">
          <BrandMark />
          <BrandName />
        </div>
        {done ? (
          <>
            <CircleCheck className="size-9 text-emerald-300" />
            <h1>Пароль изменён</h1>
            <p>Войдите с новым паролем. На всех устройствах, где был открыт аккаунт, нужно будет войти заново.</p>
            <Link href="/login" className="maryx-button pay-button">
              Войти <ArrowUpRight className="size-4" />
            </Link>
          </>
        ) : bad ? (
          <>
            <TriangleAlert className="size-8 text-amber-300" />
            <h1>Ссылка устарела</h1>
            <p>Ссылка из письма действует 1 час и только один раз. Попросите новую — это займёт минуту.</p>
            <Link href="/login" className="maryx-button pay-button">
              Получить новую ссылку
            </Link>
          </>
        ) : (
          <>
            <h1>Новый пароль</h1>
            <p>Придумайте пароль от 8 символов.</p>
            <form onSubmit={submit} aria-label="Новый пароль" className="mt-2 w-full space-y-3 text-left">
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Новый пароль"
                aria-label="Новый пароль"
                autoComplete="new-password"
                className={field}
              />
              <input
                type="password"
                required
                minLength={8}
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                placeholder="Ещё раз"
                aria-label="Повторите пароль"
                autoComplete="new-password"
                className={field}
              />
              {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</p>}
              <button
                type="submit"
                disabled={busy || !token}
                className="maryx-button flex h-[52px] w-full items-center justify-center gap-3 rounded-xl text-sm"
              >
                {busy && <LoaderCircle className="size-4 animate-spin" />}
                Сохранить пароль
              </button>
            </form>
          </>
        )}
        <Link href="/login" className="pay-back">
          ← Ко входу
        </Link>
      </div>
    </div>
  );
}
