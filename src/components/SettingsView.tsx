"use client";

import { UserRound, Palette, Gem, Brain, Circle, CircleCheck, ExternalLink, KeyRound, LogOut, Trash2 } from "@/components/MaryxIcons";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/client/auth";
import { useModels } from "@/lib/client/useModels";
import type { Capability, UsageKind } from "@/lib/types";
import { AdminCosts } from "./AdminCosts";
import { AdminQuality } from "./AdminQuality";
import { useApp } from "./AppState";
import { BillingSection, PromoAdmin } from "./BillingSection";
import { InstructionsSection } from "./InstructionsSection";
import { MemorySection } from "./MemorySection";
import { OwnKeySection } from "./OwnKeySection";
import { PageHeading } from "./Design";
import { AppearanceSection } from "./AppearanceSection";

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
                ) : p.ownKey ? (
                  <span className="text-amber-200">
                    на сервере не подключён — модели видны вам только через ваш собственный ключ
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

/**
 * The plan's daily AI budget: expensive models and big files use it up before
 * the message count does. Shown as a share, not in dollars.
 */
function BudgetMeter({ used, limit, maryxOnly }: { used: number; limit: number; maryxOnly: boolean }) {
  const share = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  return (
    <div
      className="rounded-xl border border-white/5 bg-black/15 p-4"
      title={`${maryxOnly ? "Сложные задачи" : "Дорогие модели"}, «Думать глубже» и большие файлы расходуют бюджет быстрее`}
    >
      <div className="text-xs text-zinc-500">Бюджет на ИИ</div>
      <div className="mt-1 text-sm text-zinc-200">израсходовано {Math.round(share)}%</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${share >= 100 ? "bg-red-400" : "bg-violet-400"}`} style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

/** A new password; every other device signed in with the old one is signed out. */
function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async () => {
    setBusy(true);
    setMessage(null);
    const result = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (result.error) {
      const code = result.error.code ?? "";
      setMessage({
        ok: false,
        text:
          code === "INVALID_PASSWORD"
            ? "Текущий пароль неверный."
            : code === "PASSWORD_TOO_SHORT"
              ? "Новый пароль — не короче 8 символов."
              : code === "CREDENTIAL_ACCOUNT_NOT_FOUND"
                ? "Вы входите через Google или VK — пароля у аккаунта нет."
                : (result.error.message ?? "Не удалось сменить пароль."),
      });
      return;
    }
    setCurrent("");
    setNext("");
    setMessage({ ok: true, text: "Пароль изменён. На всех других устройствах аккаунт закрыт — там нужно войти с новым паролем." });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/5"
      >
        <KeyRound className="size-4" /> Сменить пароль
      </button>
    );
  }
  const field = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-zinc-100 outline-none";
  return (
    <form
      className="w-full space-y-2 rounded-xl border border-white/10 bg-black/15 p-3 text-sm"
      aria-label="Смена пароля"
      onSubmit={(e) => {
        e.preventDefault();
        void change();
      }}
    >
      <p className="text-zinc-300">После смены пароля аккаунт закроется на всех других устройствах.</p>
      <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Текущий пароль" aria-label="Текущий пароль" className={field} />
      <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Новый пароль (от 8 символов)" aria-label="Новый пароль" className={field} />
      {message && <p className={message.ok ? "text-emerald-300" : "text-red-300"}>{message.text}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !current || next.length < 8} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-medium text-zinc-900 hover:bg-white disabled:opacity-50">
          {busy ? "Меняем…" : "Сменить пароль"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-zinc-400 hover:text-zinc-200">
          Закрыть
        </button>
      </div>
    </form>
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
          className="rounded-lg bg-red-500 px-3 py-1.5 font-medium text-[#fff] hover:bg-red-400 disabled:opacity-50"
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
  const { me, signOut, refreshMe, maryxOnly } = useApp();
  // Credits and today's usage may have changed since the app loaded (pictures, video, dictation).
  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  return (
    <div className="settings-page h-full overflow-y-auto">
      <div className="page-content !max-w-[1100px]">
        <PageHeading number="06" eyebrow="Всё под вашим контролем" title="Настройки" description="Ваш профиль, подписка и возможности. Пространство, которое работает так, как удобно вам." />
        <nav className="settings-navigation" aria-label="Разделы настроек">{[{ id: "profile", label: "Профиль" }, { id: "appearance", label: "Оформление" }, { id: "subscription", label: "Подписка" }, { id: "personalization", label: "Персонализация" }].map(s => <a key={s.id} href={`#${s.id}`}>{s.label}</a>)}</nav>

        <h2 id="profile" className="settings-section-title mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500"><UserRound className="settings-title-icon" />Аккаунт</h2>
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
                        {limit === null ? `${used} · без лимита` : limit === 0 ? "в Pro или за кредиты" : `${used} из ${limit}`}
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
                {!me.admin && me.budget.limit !== null && (
                  <BudgetMeter used={me.budget.used} limit={me.budget.limit} maryxOnly={maryxOnly} />
                )}
              </div>
              {me.ownKey && (
                <p className="mt-3 text-xs text-zinc-500">
                  Запросы через OpenRouter идут по вашему ключу и в эти лимиты не входят.
                </p>
              )}

              <div className="mt-6 flex flex-wrap items-start gap-3">
                <ChangePassword />
                <DeleteAccount />
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">Загрузка…</p>
          )}
        </div>

        <h2 id="appearance" className="settings-section-title mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500"><Palette className="settings-title-icon" />Оформление</h2>
        <AppearanceSection />

        <h2 id="subscription" className="settings-section-title mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500"><Gem className="settings-title-icon" />Подписка</h2>
        <BillingSection />

        <h2 id="personalization" className="settings-section-title mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500"><Brain className="settings-title-icon" />MARYX</h2>
        <div className="space-y-4">
          <InstructionsSection />
          <MemorySection />
        </div>

        {/* Own keys belong to the all-models mode. */}
        {!maryxOnly && (
          <>
            <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">Свой ключ</h2>
            <OwnKeySection />
          </>
        )}

        {me?.admin && (
          <>
            <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Расходы на ИИ <span className="normal-case tracking-normal">(видят только администраторы)</span>
            </h2>
            <AdminCosts />
            <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Качество ответов <span className="normal-case tracking-normal">(видят только администраторы)</span>
            </h2>
            <AdminQuality />
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
