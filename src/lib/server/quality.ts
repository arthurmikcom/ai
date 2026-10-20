// Admins: how users rate MARYX's answers — per model, why the 👎, and the
// latest 👎 to read (the users are told so when they explain a 👎) — and which
// answers failed, and why.

import { and, count, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { QualityReport } from "@/lib/types";
import { getDb, schema } from "./db";

const excerpt = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

const modelName = (provider: string | null, model: string | null) =>
  model ? (provider === "openrouter" || !provider ? model : `${provider}/${model}`) : "неизвестно";

/** What to do about a failure, by the provider's own words; most likely cause first. */
const HINTS: [RegExp, string][] = [
  [/^402\b|insufficient (credits|balance|funds)|credit balance|out of credits|quota|billing/i, "Закончились деньги у провайдера — пополните баланс (OpenRouter: openrouter.ai/settings/credits)."],
  [/^401\b|api key|unauthori[sz]ed|authentication/i, "Провайдер не принял ключ — проверьте его в Vercel → Environment Variables."],
  [/^429\b|rate.?limit|too many requests/i, "Слишком много запросов к модели. Обычно проходит само; если часто — поднимите лимит у провайдера."],
  [/^404\b|no endpoints|not found|deprecated/i, "Модель недоступна или снята с поддержки — её стоит заменить."],
  [/^413\b|context.{0,20}(length|window)|too long|maximum.{0,20}tokens/i, "Запрос не поместился в модель: очень длинный чат или большие файлы."],
  [/^(500|502|503|504|529)\b|overloaded|timed? ?out|unavailable/i, "Сбой или перегрузка у провайдера. Обычно проходит само."],
];

/** Failures that differ only in ids and numbers are one cause. */
const causeKey = (text: string) => text.replace(/[0-9a-f]{8,}|\d{4,}/gi, "#").slice(0, 160);

async function failures(since: Date): Promise<QualityReport["errors"]> {
  const db = await getDb();
  const m = schema.message;
  const failed = and(eq(m.role, "assistant"), isNotNull(m.error), gte(m.createdAt, since));
  const [[total], rows] = await Promise.all([
    db.select({ n: count() }).from(m).where(failed),
    // The latest ones are enough to see the causes.
    db
      .select({ provider: m.provider, model: m.model, error: m.error, detail: m.errorDetail, at: m.createdAt })
      .from(m)
      .where(failed)
      .orderBy(desc(m.createdAt))
      .limit(2000),
  ]);
  const causes = new Map<string, QualityReport["errors"]["causes"][number]>();
  for (const r of rows) {
    const model = modelName(r.provider, r.model);
    const cause = excerpt(r.detail || r.error || "", 300);
    const key = `${model}\n${causeKey(cause)}`;
    const seen = causes.get(key);
    if (seen) seen.count++;
    else {
      const hint = HINTS.find(([pattern]) => pattern.test(cause))?.[1];
      // Newest first: the first row of a cause is its latest.
      causes.set(key, { model, cause, ...(hint ? { hint } : {}), count: 1, last: r.at.getTime() });
    }
  }
  return { total: Number(total?.n ?? 0), causes: [...causes.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 15) };
}

export async function qualityReport(days = 30): Promise<QualityReport> {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const m = schema.message;
  const [answers] = await db
    .select({ n: count() })
    .from(m)
    .where(and(eq(m.role, "assistant"), gte(m.createdAt, since)));
  const rated = await db
    .select({ provider: m.provider, model: m.model, rating: m.rating, n: count() })
    .from(m)
    .where(and(isNotNull(m.rating), gte(m.ratedAt, since)))
    .groupBy(m.provider, m.model, m.rating);
  const models = new Map<string, { model: string; up: number; down: number }>();
  for (const r of rated) {
    const name = modelName(r.provider, r.model);
    const row = models.get(name) ?? { model: name, up: 0, down: 0 };
    if (r.rating === 1) row.up += Number(r.n);
    else row.down += Number(r.n);
    models.set(name, row);
  }
  const byModel = [...models.values()].sort((a, b) => b.down - a.down || b.up - a.up);
  const reasons = (
    await db
      .select({ reason: m.ratingReason, n: count() })
      .from(m)
      .where(and(eq(m.rating, -1), gte(m.ratedAt, since)))
      .groupBy(m.ratingReason)
  )
    .map((r) => ({ reason: r.reason ?? "", count: Number(r.n) }))
    .sort((a, b) => b.count - a.count);
  const bad = await db
    .select({ chatId: m.chatId, seq: m.seq, content: m.content, model: m.model, reason: m.ratingReason, at: m.ratedAt })
    .from(m)
    .where(and(eq(m.rating, -1), gte(m.ratedAt, since)))
    .orderBy(desc(m.ratedAt))
    .limit(10);
  const latest = await Promise.all(
    bad.map(async (b) => {
      const [question] = await db
        .select({ content: m.content })
        .from(m)
        .where(and(eq(m.chatId, b.chatId), eq(m.role, "user"), lt(m.seq, b.seq)))
        .orderBy(sql`${m.seq} desc`)
        .limit(1);
      return {
        at: b.at?.getTime() ?? 0,
        model: b.model ?? "неизвестно",
        ...(b.reason ? { reason: b.reason } : {}),
        question: excerpt(question?.content ?? "", 300),
        answer: excerpt(b.content, 400),
      };
    }),
  );
  const up = byModel.reduce((n, r) => n + r.up, 0);
  const down = byModel.reduce((n, r) => n + r.down, 0);
  return { days, answers: Number(answers?.n ?? 0), up, down, byModel, reasons, latest, errors: await failures(since) };
}
