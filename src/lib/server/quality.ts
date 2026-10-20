// Admins: how users rate MARYX's answers — per model, why the 👎, and the
// latest 👎 to read (the users are told so when they explain a 👎).

import { and, count, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { QualityReport } from "@/lib/types";
import { getDb, schema } from "./db";

const excerpt = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

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
    const name = r.model ? (r.provider === "openrouter" || !r.provider ? r.model : `${r.provider}/${r.model}`) : "неизвестно";
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
  return { days, answers: Number(answers?.n ?? 0), up, down, byModel, reasons, latest };
}
