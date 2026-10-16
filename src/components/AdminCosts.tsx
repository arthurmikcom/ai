"use client";

import { Coins, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import type { CostKind, CostReport, PaidBy } from "@/lib/types";

const usd = (v: number) =>
  v === 0 ? "$0" : v < 0.01 ? "<$0.01" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const count = (n: number) => n.toLocaleString("ru-RU");

const PERIOD: Record<CostReport["totals"][number]["period"], string> = {
  today: "Сегодня",
  week: "7 дней",
  month: "30 дней",
};

const KIND: Record<CostKind, string> = {
  chat: "Чат",
  image: "Картинки",
  video: "Видео",
  voice: "Голос",
  background: "Служебные (названия, подсказки, память)",
};

const PAYER: Record<PaidBy, string> = {
  free: "Бесплатный тариф",
  pro: "Pro",
  admin: "Администраторы",
  credits: "Кредиты",
  byok: "Свои ключи (не за счёт сайта)",
};

/** Admin-only: what AI requests cost the site, where the money goes, and a credits grant. */
export function AdminCosts() {
  const [report, setReport] = useState<CostReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const fetchReport = useCallback(
    () =>
      api<CostReport>("/api/admin/costs").then(
        (r) => {
          setReport(r);
          setError(null);
        },
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);
  const refresh = () => {
    setBusy(true);
    void fetchReport().finally(() => setBusy(false));
  };

  if (!report) {
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4 text-sm text-zinc-500">
        {error ? <span className="text-red-300">{error}</span> : <LoaderCircle className="size-5 animate-spin" />}
      </div>
    );
  }

  const days = report.days;
  const peak = Math.max(...days.map((d) => d.usd), 0.0001);
  const shown = hover !== null ? days[hover] : null;
  const { budget } = report;

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Сколько стоят запросы к ИИ за счёт сайта. OpenRouter сообщает точную стоимость каждого запроса; для остальных
          провайдеров она считается по прайсу
          {report.estimatedShare > 0.005 ? ` (оценка — ${Math.round(report.estimatedShare * 100)}% суммы)` : ""}.
        </p>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          title="Обновить"
          aria-label="Обновить"
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {report.totals.map((t) => (
          <div key={t.period} className="rounded-xl border border-white/5 bg-black/15 p-4">
            <div className="text-xs text-zinc-500">{PERIOD[t.period]}</div>
            <div className="mt-1 text-2xl font-medium tracking-tight text-zinc-100">{usd(t.usd)}</div>
            <div className="mt-0.5 text-xs text-zinc-500">запросов: {count(t.requests)}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/5 bg-black/15 p-4">
        <div className="flex items-baseline justify-between gap-2 text-xs text-zinc-500">
          <span>Расходы по дням, 30 дней</span>
          <span className="text-zinc-300">{shown ? `${shown.day}: ${usd(shown.usd)}` : `максимум за день: ${usd(peak)}`}</span>
        </div>
        <div className="mt-3 flex h-24 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => (
            <div
              key={d.day}
              className="flex h-full flex-1 items-end"
              onMouseEnter={() => setHover(i)}
              title={`${d.day}: ${usd(d.usd)}`}
            >
              <div
                className={`w-full rounded-t-[4px] ${hover === i ? "bg-violet-300" : "bg-violet-400/80"}`}
                style={{ height: d.usd > 0 ? `${Math.max(3, (d.usd / peak) * 100)}%` : "1px" }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
          <span>{days[0]?.day}</span>
          <span>сегодня</span>
        </div>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-black/15 p-4">
          <div className="text-xs text-zinc-500">Бюджет бесплатных запросов на сегодня</div>
          <div className="mt-1 text-zinc-100">
            {budget.limit === null
              ? `${usd(budget.spentToday)} · без ограничения (AI_DAILY_BUDGET_USD не задан)`
              : `${usd(budget.spentToday)} из ${usd(budget.limit)}`}
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-black/15 p-4">
          <div className="text-xs text-zinc-500">Кредиты за 30 дней</div>
          <div className="mt-1 text-zinc-100">
            начислено {count(report.credits.granted)} · потрачено {count(report.credits.spent)}
          </div>
        </div>
      </div>

      <CostTable
        title="Дороже всего — модели (30 дней)"
        rows={report.byModel.map((m) => ({ key: `${m.provider}:${m.model}`, label: m.model, sub: m.provider, usd: m.usd, n: m.requests }))}
      />
      <CostTable
        title="Дороже всего — пользователи (30 дней)"
        rows={report.byUser.map((u) => ({
          key: u.userId ?? "deleted",
          label: u.email ?? "удалённый аккаунт",
          sub: u.credits ? `кредитов: ${count(u.credits)}` : undefined,
          usd: u.usd,
          n: u.requests,
        }))}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <CostTable title="По видам" rows={report.byKind.map((k) => ({ key: k.kind, label: KIND[k.kind] ?? k.kind, usd: k.usd, n: k.requests }))} />
        <CostTable
          title="Кто платит"
          rows={report.byPayer.map((p) => ({ key: p.paidBy, label: PAYER[p.paidBy] ?? p.paidBy, usd: p.usd, n: p.requests }))}
        />
      </div>

      <GrantCredits />
    </div>
  );
}

function CostTable({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; sub?: string; usd: number; n: number }[];
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/15 p-4">
      <div className="mb-2 text-xs text-zinc-500">{title}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-600">Пока ничего.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th>Название</th>
              <th>Сумма</th>
              <th>Запросов</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="w-full max-w-0 py-1.5 pr-3">
                  <div className="truncate text-zinc-200" title={r.label}>
                    {r.label}
                  </div>
                  {r.sub && <div className="truncate text-xs text-zinc-500">{r.sub}</div>}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums text-zinc-100">{usd(r.usd)}</td>
                <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-zinc-500">{count(r.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Adds credits to a user by email (e.g. after a bank transfer, or as a gift). */
function GrantCredits() {
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState("100");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { balance } = await api<{ balance: number }>("/api/admin/credits", {
        method: "POST",
        body: JSON.stringify({ email, credits: Number(credits) }),
      });
      setMessage({ ok: true, text: `Начислено. Теперь у пользователя ${count(balance)} кредитов.` });
      setEmail("");
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy(false);
  };

  const field = "rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-zinc-100 outline-none";
  return (
    <form onSubmit={submit} className="rounded-xl border border-white/5 bg-black/15 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <Coins className="size-3.5 text-amber-300" /> Начислить кредиты пользователю
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="почта пользователя"
          aria-label="Почта пользователя"
          className={`${field} min-w-48 flex-1`}
        />
        <input
          value={credits}
          onChange={(e) => setCredits(e.target.value)}
          inputMode="numeric"
          aria-label="Кредитов"
          className={`${field} w-24`}
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : "Начислить"}
        </button>
      </div>
      {message && <p className={`mt-2 text-sm ${message.ok ? "text-emerald-300" : "text-red-300"}`}>{message.text}</p>}
    </form>
  );
}
