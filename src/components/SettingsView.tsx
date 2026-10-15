"use client";

import { Circle, CircleCheck, ExternalLink, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/client/auth";
import { useModels } from "@/lib/client/useModels";
import type { Capability, UsageKind } from "@/lib/types";
import { useApp } from "./AppState";
import { BillingSection, PromoAdmin } from "./BillingSection";
import { MemorySection } from "./MemorySection";
import { PageHeading } from "./Design";

const CAPABILITY_LABEL: Record<Capability, string> = {
  chat: "чат",
  image: "изображения",
  video: "видео",
};

const USAGE_LABEL: Record<UsageKind, string> = {
  chat: "Сообщения",
  image: "Изображения",
  video: "Видео",
  voice: "Голосовой ввод",
};

function Providers() {
  const { data, error } = useModels("all");
  const counts = new Map<string, number>();
  for (const m of data?.models ?? []) counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1);

  return (
    <>
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Провайдеры моделей <span className="normal-case tracking-normal">(видят только администраторы)</span>
      </h2>
      {error && <p className="text-sm text-red-300">Не удалось получить статус: {error}</p>}
      <div className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10">
        {(data?.providers ?? []).map((p) => (
          <div key={p.id} className="flex items-start gap-3 bg-zinc-900 p-4">
            {p.configured ? (
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" />
            ) : (
              <Circle className="mt-0.5 size-5 shrink-0 text-zinc-600" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium text-zinc-100">{p.name}</span>
                <span className="text-xs text-zinc-500">
                  {p.capabilities.map((c) => CAPABILITY_LABEL[c]).join(" · ")}
                </span>
              </div>
              <div className="text-sm text-zinc-400">{p.note}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <code className="rounded bg-white/5 px-1.5 py-0.5 text-zinc-300">{p.envVar}</code>
                {p.configured ? (
                  <span className="text-emerald-300">
                    подключён{counts.get(p.id) ? ` · моделей: ${counts.get(p.id)}` : ""}
                  </span>
                ) : (
                  <a
                    href={p.signupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200"
                  >
                    {p.id === "ollama" ? "Скачать Ollama" : "Получить ключ"} <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
        {!data && !error && <div className="bg-zinc-900 p-4 text-sm text-zinc-500">Загрузка…</div>}
      </div>
      <p className="mt-3 text-sm text-zinc-500">
        Ключи задаются в переменных окружения сервера (.env.local или настройки Vercel) и никогда не
        попадают в браузер.
      </p>
    </>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    setError(null);
    const result = await authClient.deleteUser(password ? { password } : {});
    if (result.error) {
      setError(
        result.error.code === "SESSION_EXPIRED"
          ? "Для удаления войдите в аккаунт заново."
          : (result.error.message ?? "Не удалось удалить аккаунт."),
      );
      setBusy(false);
      return;
    }
    // Full reload: the account and everything in memory is gone.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl border border-red-500/30 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10"
      >
        <Trash2 className="size-4" /> Удалить аккаунт
      </button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm">
      <p className="text-red-200">
        Все чаты, ассистенты и файлы будут удалены навсегда. Если вы входили по почте, введите пароль.
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Пароль"
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-zinc-100 outline-none"
      />
      {error && <p className="text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="rounded-lg bg-red-500 px-3 py-1.5 font-medium text-white hover:bg-red-400 disabled:opacity-50"
        >
          Удалить навсегда
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-1.5 text-zinc-300 hover:bg-white/5"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

export function SettingsView() {
  const { me, signOut } = useApp();

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-content !max-w-[1000px]">
        <PageHeading number="06" eyebrow="Всё под вашим контролем" title="Настройки" description="Ваш профиль, подписка и возможности. Пространство, которое работает так, как удобно вам." />

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">Аккаунт</h2>
        <div className="surface-card rounded-2xl p-5 md:p-7">
          {me ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-300/10 text-lg font-medium text-violet-200" aria-hidden="true">{(me.user.name || me.user.email).slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0">
                  <div className="text-lg font-medium text-zinc-100">{me.user.name}</div>
                  <div className="break-all text-sm text-zinc-400">{me.user.email}</div>
                  <button
                    type="button"
                    title="Скопировать ID аккаунта"
                    onClick={() => void navigator.clipboard.writeText(me.user.id)}
                    className="mt-2 break-all text-left font-mono text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    ID: {me.user.id}
                  </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/5"
                >
                  <LogOut className="size-4" /> Выйти
                </button>
              </div>

              <div className="mt-5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {me.admin ? "Администратор — без лимитов" : "Лимиты на сегодня"}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {(Object.keys(USAGE_LABEL) as UsageKind[]).map((kind) => {
                  const { used, limit } = me.usage[kind];
                  const share = limit ? Math.min(100, (used / limit) * 100) : 0;
                  return (
                    <div key={kind} className="rounded-xl border border-white/5 bg-black/15 p-4">
                      <div className="text-xs text-zinc-500">{USAGE_LABEL[kind]}</div>
                      <div className="mt-1 text-sm text-zinc-200">
                        {limit === null ? `${used} · без лимита` : limit === 0 ? "в тарифе Pro" : `${used} из ${limit}`}
                      </div>
                      {limit !== null && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full rounded-full ${share >= 100 ? "bg-red-400" : "bg-violet-400"}`}
                            style={{ width: `${share}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-6">
                <DeleteAccount />
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">Загрузка…</p>
          )}
        </div>

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">Подписка</h2>
        <BillingSection />

        <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">MARYX</h2>
        <MemorySection />

        {me?.admin && (
          <>
            <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Промокоды <span className="normal-case tracking-normal">(видят только администраторы)</span>
            </h2>
            <PromoAdmin />
            <Providers />
          </>
        )}
      </div>
    </div>
  );
}
