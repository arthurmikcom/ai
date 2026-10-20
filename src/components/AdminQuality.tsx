"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { RATING_REASONS } from "@/lib/ratings";
import type { QualityReport } from "@/lib/types";
import { LoaderCircle, ThumbsDown, ThumbsUp, TriangleAlert } from "./MaryxIcons";

const reasonLabel = (id: string) => RATING_REASONS.find((r) => r.id === id)?.label ?? "Без причины";
const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
const when = (at: number) => new Date(at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Admin-only: how users rate MARYX's answers (👍/👎) — per model, why, and the
 * latest 👎 to read — and which answers failed, in the provider's own words.
 */
export function AdminQuality() {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<QualityReport>("/api/admin/quality").then(setReport, (e: Error) => setError(e.message));
  }, []);

  if (!report) {
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4 text-sm text-zinc-500">
        {error ? <span className="text-red-300">{error}</span> : <LoaderCircle className="size-5 animate-spin" />}
      </div>
    );
  }
  const rated = report.up + report.down;
  return (
    <section aria-label="Качество ответов" className="admin-quality space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-4">
      <p className="text-sm text-zinc-400">
        Как пользователи оценивают ответы MARYX за {report.days} дней. Модели с большой долей 👎 — первые кандидаты на замену;
        причины подскажут, что поправить в инструкциях.
      </p>
      <div className="admin-quality-totals">
        <div>
          <strong>{report.answers.toLocaleString("ru-RU")}</strong>
          <small>ответов</small>
        </div>
        <div>
          <strong>
            <ThumbsUp size={15} /> {report.up}
          </strong>
          <small>{share(report.up, rated)} оценок</small>
        </div>
        <div>
          <strong>
            <ThumbsDown size={15} /> {report.down}
          </strong>
          <small>{share(report.down, rated)} оценок</small>
        </div>
        <div>
          <strong className={report.errors.total ? "text-amber-300" : undefined}>
            <TriangleAlert size={15} /> {report.errors.total}
          </strong>
          <small>{share(report.errors.total, report.answers)} ответов с ошибкой</small>
        </div>
      </div>
      {rated === 0 ? (
        <p className="text-sm text-zinc-500">Оценок пока нет.</p>
      ) : (
        <>
          <table className="admin-quality-table">
            <thead>
              <tr>
                <th>Модель</th>
                <th>👍</th>
                <th>👎</th>
                <th>Доля 👎</th>
              </tr>
            </thead>
            <tbody>
              {report.byModel.map((m) => (
                <tr key={m.model}>
                  <td>{m.model}</td>
                  <td>{m.up}</td>
                  <td>{m.down}</td>
                  <td>{share(m.down, m.up + m.down)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.reasons.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-zinc-300">Что не так</h3>
              <ul className="admin-quality-reasons">
                {report.reasons.map((r) => (
                  <li key={r.reason}>
                    {reasonLabel(r.reason)} <span>{r.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.latest.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-zinc-300">Последние 👎</h3>
              <ul className="admin-quality-latest">
                {report.latest.map((l, i) => (
                  <li key={i}>
                    <div className="admin-quality-meta">
                      {when(l.at)} · {l.model}
                      {l.reason && <> · {reasonLabel(l.reason)}</>}
                    </div>
                    <p>
                      <b>Вопрос:</b> {l.question || "—"}
                    </p>
                    <p>
                      <b>Ответ:</b> {l.answer}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="admin-quality-errors">
        <h3 className="mb-2 text-sm font-medium text-zinc-300">Ошибки ответов</h3>
        {report.errors.causes.length === 0 ? (
          <p className="text-sm text-zinc-500">Все ответы получились.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-zinc-400">
              Настоящие причины — словами провайдера. Пользователи их не видят: им MARYX пишет, что попробует позже.
            </p>
            <ul className="admin-quality-latest">
              {report.errors.causes.map((c, i) => (
                <li key={i}>
                  <div className="admin-quality-meta">
                    {c.count} × · {c.model} · последняя {when(c.last)}
                  </div>
                  <p className="admin-quality-cause">{c.cause || "—"}</p>
                  {c.hint && <p className="admin-quality-hint">{c.hint}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
