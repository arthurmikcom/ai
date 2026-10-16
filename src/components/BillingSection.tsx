"use client";

import { Coins, Copy, LoaderCircle, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import type { PromoCode } from "@/lib/types";
import { useApp } from "./AppState";
import { PromoForm } from "./PromoForm";

const date = (ms: number) => new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/** Current plan, renewal controls and promo code field. */
export function BillingSection() {
  const { me, refreshMe } = useApp();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Back from a payment page: confirm the payment right away instead of
  // waiting for the provider's webhook.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returned = params.get("billing");
    const method =
      returned === "return" ? "yookassa" : returned === "stripe" ? "stripe" : returned === "stripe-credits" ? "stripe-credits" : null;
    if (!method) return;
    const sessionId = params.get("session_id") ?? undefined;
    window.history.replaceState(null, "", window.location.pathname);
    api<{ status: string; credits?: number | boolean }>("/api/billing/sync", {
      method: "POST",
      body: JSON.stringify({ method, sessionId }),
    })
      .then(({ status, credits }) => {
        const what = credits ? "кредиты" : "Pro";
        setMessage(
          status === "succeeded"
            ? { ok: true, text: credits ? "Оплата прошла — кредиты зачислены. Спасибо!" : "Оплата прошла — Pro активирован. Спасибо!" }
            : status === "pending"
              ? { ok: true, text: `Платёж обрабатывается. ${credits ? "Кредиты появятся" : "Pro включится"} автоматически через минуту.` }
              : { ok: false, text: `Платёж не прошёл, ${what} не ${credits ? "зачислены" : "активирован"}. Попробуйте ещё раз.` },
        );
        refreshMe();
      })
      .catch((e: Error) => setMessage({ ok: false, text: e.message }));
  }, [refreshMe]);

  if (!me) return null;
  const { plan } = me;

  const call = async (path: string, redirect = false) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ url?: string }>(path, { method: "POST" });
      if (redirect && res.url) {
        window.location.href = res.url;
        return;
      }
      refreshMe();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium text-zinc-100">
            {plan.id === "pro" && <Sparkles className="size-4 text-violet-300" />}
            {plan.id === "pro" ? "Pro" : "Бесплатный тариф"}
          </div>
          <div className="mt-1 text-sm text-zinc-400">
            {plan.id === "free" && "Больше сообщений, картинок и видео — на тарифе Pro."}
            {plan.id === "pro" && plan.provider === "promo" && plan.periodEnd && `По промокоду до ${date(plan.periodEnd)}`}
            {plan.id === "pro" && plan.provider !== "promo" && plan.periodEnd &&
              (plan.endsAtPeriodEnd || !plan.renewsAt
                ? `Автопродление отключено. Доступ до ${date(plan.periodEnd)}`
                : `Доступ до ${date(plan.periodEnd)}. Следующее списание — ${date(plan.renewsAt)}`)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {plan.id === "free" && !plan.stripeLive && (
            <Link
              href="/pricing"
              className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              Перейти на Pro
            </Link>
          )}
          {plan.provider === "stripe" && plan.stripeLive && (
            <button
              type="button"
              disabled={busy}
              onClick={() => call("/api/billing/portal", true)}
              className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-200 hover:bg-white/5 disabled:opacity-50"
            >
              Управлять подпиской
            </button>
          )}
          {plan.id === "pro" && plan.repay && (
            <Link
              href="/pricing"
              className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              Оплатить заново
            </Link>
          )}
          {plan.id === "pro" && plan.provider === "yookassa" &&
            (plan.endsAtPeriodEnd ? (
              // Without a saved card there's nothing to resume: paying again saves a new one.
              plan.cardSaved && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => call("/api/billing/resume")}
                  className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Возобновить автопродление
                </button>
              )
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm("Отключить автопродление? Pro останется до конца оплаченного периода.")) {
                    void call("/api/billing/cancel");
                  }
                }}
                className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-50"
              >
                Отменить автопродление
              </button>
            ))}
        </div>
      </div>

      {(plan.status === "past_due" || plan.status === "unpaid") && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {plan.provider === "stripe"
            ? "Не удалось списать оплату за продление. Обновите карту в «Управлять подпиской»."
            : plan.cardSaved
              ? "Не удалось списать оплату за продление. Мы попробуем ещё раз, или оплатите заново — новый месяц начнётся после текущего."
              : "Не удалось списать оплату за продление, карта больше не принимается. Оплатите заново — новый месяц начнётся после текущего."}
        </div>
      )}
      {message && (
        <p className={`mt-3 text-sm ${message.ok ? "text-emerald-300" : "text-red-300"}`}>{message.text}</p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
        <div className="flex items-center gap-2">
          <Coins className="size-4 text-amber-300" />
          <div>
            <div className="text-sm text-zinc-100">
              Кредиты: <span className="font-medium">{me.credits.toLocaleString("ru-RU")}</span>
            </div>
            <div className="text-xs text-zinc-500">Тратятся, когда дневной лимит закончился. Не сгорают.</div>
          </div>
        </div>
        <Link
          href="/pricing#credits"
          className="rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-200 hover:bg-white/5"
        >
          Купить кредиты
        </Link>
      </div>

      <div className="mt-5 border-t border-white/5 pt-4">
        <div className="mb-2 text-xs text-zinc-500">Промокод</div>
        <PromoForm />
      </div>
    </div>
  );
}

/** Admin-only: create and revoke promo codes. */
export function PromoAdmin() {
  const [codes, setCodes] = useState<PromoCode[] | null>(null);
  const [days, setDays] = useState("30");
  const [credits, setCredits] = useState("0");
  const [maxUses, setMaxUses] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<PromoCode[]>("/api/admin/promo").then(setCodes, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/promo", {
        method: "POST",
        body: JSON.stringify({ days: Number(days), credits: Number(credits || 0), maxUses: Number(maxUses), note }),
      });
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const remove = async (code: string) => {
    if (!confirm(`Удалить промокод ${code}?`)) return;
    await api(`/api/admin/promo?code=${encodeURIComponent(code)}`, { method: "DELETE" }).catch((e: Error) =>
      setError(e.message),
    );
    await load();
  };

  const field = "rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-zinc-100 outline-none";

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4">
      <p className="text-sm text-zinc-400">
        Промокод даёт Pro на заданное число дней и/или кредиты. Удобно, чтобы дарить доступ или принимать оплату
        переводом без платёжной системы.
      </p>
      <form onSubmit={create} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-500">
          Дней Pro
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className={`${field} mt-1 block w-20`} />
        </label>
        <label className="text-xs text-zinc-500">
          Кредитов
          <input value={credits} onChange={(e) => setCredits(e.target.value)} inputMode="numeric" className={`${field} mt-1 block w-24`} />
        </label>
        <label className="text-xs text-zinc-500">
          Активаций
          <input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} inputMode="numeric" className={`${field} mt-1 block w-24`} />
        </label>
        <label className="min-w-40 flex-1 text-xs text-zinc-500">
          Заметка
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="для кого" className={`${field} mt-1 block w-full`} />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : "Создать код"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

      <div className="mt-4 divide-y divide-white/5">
        {codes?.length === 0 && <p className="py-2 text-sm text-zinc-500">Кодов пока нет.</p>}
        {codes?.map((c) => (
          <div key={c.code} className="flex items-center gap-3 py-2 text-sm">
            <code className="font-mono text-zinc-100">{c.code}</code>
            <button
              type="button"
              title="Копировать"
              onClick={() => void navigator.clipboard.writeText(c.code)}
              className="text-zinc-500 hover:text-zinc-200"
            >
              <Copy className="size-3.5" />
            </button>
            <span className="text-zinc-400">
              {[c.days ? `${c.days} дн.` : "", c.credits ? `${c.credits} кр.` : ""].filter(Boolean).join(" + ")} · {c.uses}/{c.maxUses}
            </span>
            <span className="min-w-0 flex-1 truncate text-zinc-500">{c.note}</span>
            <button type="button" title="Удалить" onClick={() => void remove(c.code)} className="text-zinc-500 hover:text-red-300">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
