// The cost ledger: what every AI request cost, who it was for and how it was
// paid. It drives the per-user daily budgets, the site-wide budget for free
// requests and the admin's cost dashboard.

import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { ChatRequest, ChatUsage, CostKind, CostReport, PaidBy, PlanId, ProviderId } from "@/lib/types";
import { getDb, schema } from "./db";
import { chatCost, tokensOf } from "./pricing";

export interface CostEntry {
  kind: CostKind;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  usd: number;
  estimated: boolean;
}

/** Who MARYX's background jobs for a request are recorded against, and with which key they run. */
export interface Meter {
  userId: string;
  paidBy: PaidBy;
  /** The user's own OpenRouter key (paidBy "byok"). */
  key?: string;
}

/** Characters a chat request sends, to estimate its tokens; a picture counts as ~1000 tokens. */
export function requestChars(req: ChatRequest): number {
  return (
    (req.system?.length ?? 0) +
    req.messages.reduce((sum, m) => sum + m.content.length + (m.attachments?.length ?? 0) * 3500, 0)
  );
}

/**
 * The cost of one chat call: from the usage the provider reported, or, when the
 * call ended before reporting it (stopped, failed mid-answer), estimated from
 * the characters sent and received. Null for a call that produced nothing.
 */
export function chatEntry(
  kind: CostKind,
  provider: ProviderId,
  model: string,
  usage: ChatUsage | undefined,
  chars: { input: number; output: number },
): CostEntry | null {
  const used = usage ?? (chars.output > 0 ? { inputTokens: tokensOf(chars.input), outputTokens: tokensOf(chars.output) } : null);
  if (!used) return null;
  const { usd, estimated } = chatCost(provider, model, used);
  return { kind, provider, model, inputTokens: used.inputTokens, outputTokens: used.outputTokens, usd, estimated: estimated || !usage };
}

/** Start of the current UTC day; the daily limits reset at the same time. */
export function startOfDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Writes the cost of one request's model calls. `credits` (taken from the
 * user's balance for the whole request) is stored on the first row.
 */
export async function recordCosts(
  userId: string | null,
  paidBy: PaidBy,
  entries: CostEntry[],
  credits = 0,
): Promise<void> {
  const rows = entries
    .filter((e) => Number.isFinite(e.usd) && e.usd >= 0)
    .map((e, i) => ({
      id: crypto.randomUUID(),
      userId,
      kind: e.kind,
      provider: e.provider.slice(0, 40),
      model: e.model.slice(0, 200),
      inputTokens: e.inputTokens === undefined ? null : Math.round(e.inputTokens),
      outputTokens: e.outputTokens === undefined ? null : Math.round(e.outputTokens),
      costUsd: e.usd,
      estimated: e.estimated,
      paidBy,
      credits: i === 0 ? credits : 0,
    }));
  if (!rows.length) return;
  const db = await getDb();
  try {
    await db.insert(schema.aiCost).values(rows);
  } catch (err) {
    // The account may have been deleted meanwhile; keep the cost without it.
    if (!userId) throw err;
    await db.insert(schema.aiCost).values(rows.map((r) => ({ ...r, userId: null })));
  }
  if (paidBy === "free") freeSpend.at = 0;
}

/**
 * Today's spending on a user's requests that the plan pays for: requests paid
 * with credits or with the user's own key don't use up the plan's budget.
 */
export async function userSpendToday(userId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${schema.aiCost.costUsd}), 0)` })
    .from(schema.aiCost)
    .where(
      and(
        eq(schema.aiCost.userId, userId),
        gte(schema.aiCost.at, startOfDay()),
        inArray(schema.aiCost.paidBy, ["free", "pro", "admin"]),
      ),
    );
  return Number(row?.usd ?? 0);
}

/** Daily AI budget per user in USD (FREE_DAILY_USD, PRO_DAILY_USD); null = none. */
export function planDailyUsd(plan: PlanId): number | null {
  const raw = process.env[plan === "free" ? "FREE_DAILY_USD" : "PRO_DAILY_USD"]?.trim();
  if (raw === "unlimited") return null;
  const value = raw ? Number.parseFloat(raw) : NaN;
  if (Number.isFinite(value) && value >= 0) return value;
  return plan === "free" ? 0.1 : 1;
}

/** Site-wide daily budget for free-plan requests (AI_DAILY_BUDGET_USD); null = none. */
export function siteDailyBudget(): number | null {
  const value = Number.parseFloat(process.env.AI_DAILY_BUDGET_USD ?? "");
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Today's free-plan spending, re-read at most every 15 seconds (and after each free request). */
const freeSpend = { at: 0, day: "", usd: 0 };

export async function freeSpendToday(): Promise<number> {
  const day = startOfDay().toISOString();
  if (freeSpend.day === day && Date.now() - freeSpend.at < 15_000) return freeSpend.usd;
  const db = await getDb();
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${schema.aiCost.costUsd}), 0)` })
    .from(schema.aiCost)
    .where(and(gte(schema.aiCost.at, startOfDay()), inArray(schema.aiCost.paidBy, ["free"])));
  Object.assign(freeSpend, { at: Date.now(), day, usd: Number(row?.usd ?? 0) });
  return freeSpend.usd;
}

/** Whether the site's free budget for today is used up. */
export async function siteBudgetSpent(): Promise<boolean> {
  const budget = siteDailyBudget();
  return budget !== null && (await freeSpendToday()) >= budget;
}

// ---------- Admin dashboard ----------

const DAY_MS = 24 * 60 * 60 * 1000;

/** What AI requests cost over the last 30 days, for the admin dashboard. */
export async function costReport(): Promise<CostReport> {
  const db = await getDb();
  const today = startOfDay();
  const week = new Date(today.getTime() - 6 * DAY_MS);
  const month = new Date(today.getTime() - 29 * DAY_MS);
  const c = schema.aiCost;
  // Raw SQL fragments take dates as text (the driver doesn't convert them there).
  const [todayAt, weekAt] = [today.toISOString(), week.toISOString()];
  const usd = sql<number>`coalesce(sum(${c.costUsd}), 0)`;
  const requests = sql<number>`count(*)`;
  const costliest = sql`sum(${c.costUsd}) desc`;
  const site = and(gte(c.at, month), ne(c.paidBy, "byok"));

  const [totals, byok, estimated, days, byModel, byUser, byKind, byPayer, granted, spent] = await Promise.all([
    db
      .select({
        today: sql<number>`coalesce(sum(${c.costUsd}) filter (where ${c.at} >= ${todayAt}), 0)`,
        todayN: sql<number>`count(*) filter (where ${c.at} >= ${todayAt})`,
        week: sql<number>`coalesce(sum(${c.costUsd}) filter (where ${c.at} >= ${weekAt}), 0)`,
        weekN: sql<number>`count(*) filter (where ${c.at} >= ${weekAt})`,
        month: usd,
        monthN: requests,
        free: sql<number>`coalesce(sum(${c.costUsd}) filter (where ${c.at} >= ${todayAt} and ${c.paidBy} = 'free'), 0)`,
      })
      .from(c)
      .where(site),
    db.select({ usd, requests }).from(c).where(and(gte(c.at, month), eq(c.paidBy, "byok"))),
    db.select({ usd }).from(c).where(and(site, eq(c.estimated, true))),
    db
      .select({ day: sql<string>`to_char(date_trunc('day', ${c.at}), 'YYYY-MM-DD')`, usd })
      .from(c)
      .where(site)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({ provider: c.provider, model: c.model, usd, requests })
      .from(c)
      .where(site)
      .groupBy(c.provider, c.model)
      .orderBy(costliest)
      .limit(15),
    db
      .select({
        userId: c.userId,
        email: schema.user.email,
        usd,
        requests,
        credits: sql<number>`coalesce(sum(${c.credits}), 0)`,
      })
      .from(c)
      .leftJoin(schema.user, eq(schema.user.id, c.userId))
      .where(site)
      .groupBy(c.userId, schema.user.email)
      .orderBy(costliest)
      .limit(15),
    db.select({ kind: c.kind, usd, requests }).from(c).where(site).groupBy(c.kind).orderBy(costliest),
    db.select({ paidBy: c.paidBy, usd, requests }).from(c).where(gte(c.at, month)).groupBy(c.paidBy).orderBy(costliest),
    db
      .select({ n: sql<number>`coalesce(sum(${schema.creditGrant.credits}), 0)` })
      .from(schema.creditGrant)
      .where(gte(schema.creditGrant.createdAt, month)),
    db.select({ n: sql<number>`coalesce(sum(${c.credits}), 0)` }).from(c).where(gte(c.at, month)),
  ]);

  const t = totals[0];
  const monthUsd = Number(t?.month ?? 0);
  const num = (v: unknown) => Number(v ?? 0);
  return {
    totals: [
      { period: "today", usd: num(t?.today), requests: num(t?.todayN) },
      { period: "week", usd: num(t?.week), requests: num(t?.weekN) },
      { period: "month", usd: monthUsd, requests: num(t?.monthN) },
    ],
    byok: { usd: num(byok[0]?.usd), requests: num(byok[0]?.requests) },
    budget: { limit: siteDailyBudget(), spentToday: num(t?.free) },
    estimatedShare: monthUsd > 0 ? num(estimated[0]?.usd) / monthUsd : 0,
    // Every one of the last 30 days, empty ones included.
    days: Array.from({ length: 30 }, (_, i) => {
      const day = new Date(month.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      return { day, usd: num(days.find((d) => d.day === day)?.usd) };
    }),
    byModel: byModel.map((m) => ({ provider: m.provider, model: m.model, usd: num(m.usd), requests: num(m.requests) })),
    byUser: byUser.map((u) => ({
      userId: u.userId,
      email: u.email,
      usd: num(u.usd),
      requests: num(u.requests),
      credits: num(u.credits),
    })),
    byKind: byKind.map((k) => ({ kind: k.kind, usd: num(k.usd), requests: num(k.requests) })),
    byPayer: byPayer.map((p) => ({ paidBy: p.paidBy, usd: num(p.usd), requests: num(p.requests) })),
    credits: { granted: num(granted[0]?.n), spent: num(spent[0]?.n) },
  };
}
