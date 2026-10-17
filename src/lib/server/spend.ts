// The cost ledger: what every AI request cost, who it was for and how it was
// paid. It drives the per-user daily budgets, the site-wide budget for free
// requests and the admin's cost dashboard.

import { and, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import type { ChatRequest, ChatUsage, CostKind, CostReport, PaidBy, PlanId, ProviderId } from "@/lib/types";
import { getDb, schema, type DB } from "./db";
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

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Conn = DB | Tx;

/** Characters a chat request sends, to estimate its tokens; a picture counts as ~1000 tokens. */
export function requestChars(req: ChatRequest): number {
  return (
    (req.system?.length ?? 0) +
    req.messages.reduce((sum, m) => sum + m.content.length + (m.attachments?.length ?? 0) * 3500, 0)
  );
}

/** Hidden reasoning a model may bill while nothing is streamed yet, per second of waiting (conservative). */
const HIDDEN_TOKENS_PER_SECOND = 40;

/**
 * The cost of one chat call: from the usage the provider reported, or, when the
 * call ended before reporting it, estimated from the characters sent and
 * received. A call that was stopped (by the user or the time limit) is billed
 * by the provider for what it read and thought so far, so it gets at least the
 * input plus a time-based allowance for hidden reasoning (no more than the
 * call's output limit, when it had one). `partial`: the call
 * didn't run to its end, so usage it reported along the way (Anthropic and
 * Gemini report as they go) is only a lower bound. Null for a call that failed
 * before producing anything (the provider refused it).
 */
export function chatEntry(
  kind: CostKind,
  provider: ProviderId,
  model: string,
  usage: ChatUsage | undefined,
  chars: { input: number; output: number },
  stopped?: { seconds: number; maxTokens?: number },
  partial = false,
): CostEntry | null {
  const exact = usage && (!partial || usage.cost !== undefined);
  let used: ChatUsage;
  if (exact) {
    used = usage;
  } else {
    if (!usage && chars.output === 0 && !stopped) return null;
    const hidden = stopped ? Math.min(Math.round(stopped.seconds * HIDDEN_TOKENS_PER_SECOND), stopped.maxTokens ?? Infinity) : 0;
    used = {
      inputTokens: Math.max(usage?.inputTokens ?? 0, tokensOf(chars.input)),
      outputTokens: Math.max(usage?.outputTokens ?? 0, tokensOf(chars.output), hidden),
    };
  }
  const { usd, estimated } = chatCost(provider, model, used);
  return { kind, provider, model, inputTokens: used.inputTokens, outputTokens: used.outputTokens, usd, estimated: estimated || !exact };
}

/** Start of the current UTC day; the daily limits reset at the same time. */
export function startOfDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isForeignKeyViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return (e?.code ?? e?.cause?.code) === "23503";
}

/**
 * Writes the cost of one request's model calls and drops its reservation (the
 * pending row under `chargeId`). `credits` (taken from the user's balance for
 * the whole request) is stored on the first row; credits taken for a request
 * that left no cost behind still get a row, so the totals add up.
 */
export async function recordCosts(
  userId: string | null,
  paidBy: PaidBy,
  entries: CostEntry[],
  credits = 0,
  opts: { chargeId?: string; kind?: CostKind } = {},
): Promise<void> {
  const at = new Date();
  const rows = entries
    .filter((e) => Number.isFinite(e.usd) && e.usd >= 0)
    .map((e) => ({
      id: crypto.randomUUID(),
      userId,
      at,
      kind: e.kind,
      provider: e.provider.slice(0, 40),
      model: e.model.slice(0, 200),
      inputTokens: e.inputTokens === undefined ? null : Math.round(e.inputTokens),
      outputTokens: e.outputTokens === undefined ? null : Math.round(e.outputTokens),
      costUsd: e.usd,
      estimated: e.estimated,
      paidBy,
      credits: 0,
    }));
  if (!rows.length && credits > 0) {
    rows.push({
      id: crypto.randomUUID(), userId, at, kind: opts.kind ?? "chat", provider: "-", model: "-",
      inputTokens: null, outputTokens: null, costUsd: 0, estimated: true, paidBy, credits: 0,
    });
  }
  if (rows.length) rows[0].credits = credits;
  const db = await getDb();
  const write = (values: typeof rows) =>
    db.transaction(async (tx) => {
      if (opts.chargeId) await tx.delete(schema.aiCost).where(and(eq(schema.aiCost.id, opts.chargeId), eq(schema.aiCost.pending, true)));
      if (values.length) await tx.insert(schema.aiCost).values(values);
    });
  try {
    await write(rows);
  } catch (err) {
    // The account was deleted meanwhile: keep the cost for the totals, without it.
    if (!userId || !isForeignKeyViolation(err)) throw err;
    await write(rows.map((r) => ({ ...r, userId: null })));
  }
}

/**
 * Holds a request's estimated cost in the ledger while it runs (a pending row
 * under the charge's id), so parallel requests see each other in the budgets.
 * recordCosts replaces it with the real cost.
 */
export async function insertReservation(
  conn: Conn,
  r: { id: string; userId: string; kind: CostKind; provider: string; model: string; usd: number; paidBy: PaidBy },
): Promise<void> {
  await conn
    .insert(schema.aiCost)
    .values({
      id: r.id,
      userId: r.userId,
      at: new Date(),
      kind: r.kind,
      provider: r.provider.slice(0, 40),
      model: r.model.slice(0, 200),
      costUsd: r.usd,
      estimated: true,
      paidBy: r.paidBy,
      pending: true,
    })
    .onConflictDoNothing();
}

/** Drops a request's reservation without recording a cost (its cost couldn't be written). */
export async function dropReservation(chargeId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.aiCost).where(and(eq(schema.aiCost.id, chargeId), eq(schema.aiCost.pending, true)));
}

/**
 * A chat answer or dictation can't run longer than its function's time limit
 * (5 minutes): a reservation older than this was never replaced (the function
 * was killed) and no longer holds anything. Pictures and video are held until
 * the provider's job is done, which can take longer.
 */
const STALE_AFTER_MS = 6 * 60_000;

/** Ledger rows that count toward today's spending: costs, and reservations of requests still running. */
function counted(opts: { settled?: boolean }) {
  const c = schema.aiCost;
  if (opts.settled) return eq(c.pending, false);
  return or(eq(c.pending, false), gte(c.at, new Date(Date.now() - STALE_AFTER_MS)), inArray(c.kind, ["image", "video"]));
}

/** Whether a request of the user's paid with credits is running (and holding some). */
export async function hasPendingCredits(userId: string, except?: string): Promise<boolean> {
  const db = await getDb();
  const c = schema.aiCost;
  const rows = await db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.userId, userId), eq(c.pending, true), eq(c.paidBy, "credits"), gte(c.at, new Date(Date.now() - STALE_AFTER_MS)), ...(except ? [ne(c.id, except)] : [])))
    .limit(1);
  return rows.length > 0;
}

/** Kinds the per-user daily budget applies to; pictures and video are governed by their daily counts. */
export const BUDGETED: CostKind[] = ["chat", "voice", "background"];

/**
 * Today's spending (finished and still running) on a user's chat, dictation and
 * MARYX's jobs that the plan pays for: requests paid with credits or with the
 * user's own key, and pictures and video, don't use up the plan's budget.
 * `settled`: only what was actually spent, not what running requests hold.
 */
export async function userSpendToday(userId: string, conn?: Conn, opts: { settled?: boolean } = {}): Promise<number> {
  const db = conn ?? (await getDb());
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${schema.aiCost.costUsd}), 0)` })
    .from(schema.aiCost)
    .where(
      and(
        eq(schema.aiCost.userId, userId),
        gte(schema.aiCost.at, startOfDay()),
        inArray(schema.aiCost.paidBy, ["free", "pro", "admin"]),
        inArray(schema.aiCost.kind, BUDGETED),
        counted(opts),
      ),
    );
  return Number(row?.usd ?? 0);
}

/** Daily AI budget per user in USD for chat and dictation (FREE_DAILY_USD, PRO_DAILY_USD); null = none. */
export function planDailyUsd(plan: PlanId): number | null {
  const raw = process.env[plan === "free" ? "FREE_DAILY_USD" : "PRO_DAILY_USD"]?.trim();
  if (raw === "unlimited") return null;
  const value = raw ? Number.parseFloat(raw) : NaN;
  if (Number.isFinite(value) && value >= 0) return value;
  return plan === "free" ? 0.2 : 1;
}

/** Site-wide daily budget for free-plan requests (AI_DAILY_BUDGET_USD); null = none. */
export function siteDailyBudget(): number | null {
  const value = Number.parseFloat(process.env.AI_DAILY_BUDGET_USD ?? "");
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Today's spending on free-plan requests across the site, including those still running. */
export async function freeSpendToday(conn?: Conn): Promise<number> {
  const db = conn ?? (await getDb());
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${schema.aiCost.costUsd}), 0)` })
    .from(schema.aiCost)
    .where(and(gte(schema.aiCost.at, startOfDay()), eq(schema.aiCost.paidBy, "free"), counted({})));
  return Number(row?.usd ?? 0);
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
  // A request is what a user asked for; MARYX's own jobs (titles, follow-ups) aren't counted as requests.
  const requests = sql<number>`count(*) filter (where ${c.kind} <> 'background')`;
  const costliest = sql`sum(${c.costUsd}) desc`;
  const site = and(gte(c.at, month), ne(c.paidBy, "byok"));

  const [totals, byok, estimated, days, byModel, byUser, byKind, byPayer, granted, spent] = await Promise.all([
    db
      .select({
        today: sql<number>`coalesce(sum(${c.costUsd}) filter (where ${c.at} >= ${todayAt}), 0)`,
        todayN: sql<number>`count(*) filter (where ${c.at} >= ${todayAt} and ${c.kind} <> 'background')`,
        week: sql<number>`coalesce(sum(${c.costUsd}) filter (where ${c.at} >= ${weekAt}), 0)`,
        weekN: sql<number>`count(*) filter (where ${c.at} >= ${weekAt} and ${c.kind} <> 'background')`,
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
    db.select({ kind: c.kind, usd, requests: sql<number>`count(*)` }).from(c).where(site).groupBy(c.kind).orderBy(costliest),
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
