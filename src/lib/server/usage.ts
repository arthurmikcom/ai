import { and, eq, sql } from "drizzle-orm";
import { USAGE_KINDS, type PaidBy, type UsageKind, type UsageSummary } from "@/lib/types";
import { isAdmin, type SessionUser } from "./auth";
import { creditsFor, holdCredits, MIN_CREDITS, releaseCredits, takeCredits } from "./billing/credits";
import { currentPlan, planLimit } from "./billing/plans";
import { stripeCreditsConfigured } from "./billing/stripe";
import { yookassaConfigured } from "./billing/yookassa";
import { getDb, schema } from "./db";
import { planDailyUsd, recordCosts, siteBudgetSpent, userSpendToday, type CostEntry } from "./spend";

/** Today's limit for this user; null means unlimited. */
export async function dailyLimit(user: SessionUser, kind: UsageKind): Promise<number | null> {
  if (isAdmin(user)) return null;
  const { plan } = await currentPlan(user.id);
  return planLimit(plan, kind);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const LIMIT_NAMES: Record<UsageKind, string> = {
  chat: "сообщения",
  image: "изображения",
  video: "видео",
  voice: "голосовой ввод",
};

/** Error body for a reached limit; `code` lets the UI offer an upgrade. */
export async function limitResponse(user: SessionUser, kind: UsageKind): Promise<Response> {
  return deniedResponse(user, kind, "limit");
}

/**
 * Counts one use against today's limit. Returns false (and counts nothing)
 * when the limit is already reached. Atomic, so parallel requests can't
 * slip past the limit.
 */
export async function consume(user: SessionUser, kind: UsageKind): Promise<boolean> {
  return bump(user.id, kind, await dailyLimit(user, kind));
}

/** Counter kinds besides the plan's: requests made with the user's own key. */
type Counter = UsageKind | "byok";

async function bump(userId: string, kind: Counter, limit: number | null): Promise<boolean> {
  if (limit === 0) return false;
  const db = await getDb();
  const rows = await db
    .insert(schema.usage)
    .values({ userId, day: today(), kind: kind as UsageKind, count: 1 })
    .onConflictDoUpdate({
      target: [schema.usage.userId, schema.usage.day, schema.usage.kind],
      set: { count: sql`${schema.usage.count} + 1` },
      ...(limit === null ? {} : { setWhere: sql`${schema.usage.count} < ${limit}` }),
    })
    .returning({ count: schema.usage.count });
  return rows.length > 0;
}

/** Gives back a use when the provider failed before producing anything. */
export async function refund(userId: string, kind: Counter): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.usage)
    .set({ count: sql`greatest(${schema.usage.count} - 1, 0)` })
    .where(
      and(
        eq(schema.usage.userId, userId),
        eq(schema.usage.day, today()),
        eq(schema.usage.kind, kind as UsageKind),
      ),
    );
}

export async function usageSummary(user: SessionUser): Promise<UsageSummary> {
  const db = await getDb();
  const rows = await db
    .select({ kind: schema.usage.kind, count: schema.usage.count })
    .from(schema.usage)
    .where(and(eq(schema.usage.userId, user.id), eq(schema.usage.day, today())));
  const admin = isAdmin(user);
  const { plan } = await currentPlan(user.id);
  const used = (kind: UsageKind) => rows.find((r) => r.kind === kind)?.count ?? 0;
  const limit = (kind: UsageKind) => (admin ? null : planLimit(plan, kind));
  return Object.fromEntries(USAGE_KINDS.map((k) => [k, { used: used(k), limit: limit(k) }])) as UsageSummary;
}


// ---------- Paying for one request ----------

/**
 * How one request is paid for, decided before it starts. With the user's own
 * OpenRouter key it costs the site nothing. Otherwise it counts toward the
 * plan's daily limit, within the plan's daily budget (expensive models and big
 * files use it up faster) and, for free requests, the site-wide daily budget.
 * Past any of those it is paid with credits, if the user has some.
 */
export interface Charge {
  userId: string;
  kind: UsageKind;
  paidBy: PaidBy;
  /** Credits held when it started (paidBy "credits"); the real cost is settled at the end. */
  held: number;
  /** The user's own OpenRouter key (paidBy "byok"). */
  key?: string;
}

/**
 * Why a request was refused: the plan's count limit, the user's daily budget,
 * the site's budget for free requests, or the daily count for one's own key.
 */
export type Denial = "limit" | "spend" | "budget" | "ownKey";

/** Requests a day with one's own key: no cost to the site, but the server still does the work. */
const OWN_KEY_DAILY = 3000;

export async function charge(user: SessionUser, kind: UsageKind, ownKey?: string): Promise<Charge | { denied: Denial }> {
  const base = { userId: user.id, kind, held: 0 };
  if (ownKey) {
    return (await bump(user.id, "byok", OWN_KEY_DAILY)) ? { ...base, paidBy: "byok", key: ownKey } : { denied: "ownKey" };
  }
  if (isAdmin(user)) {
    await bump(user.id, kind, null);
    return { ...base, paidBy: "admin" };
  }
  const { plan } = await currentPlan(user.id);
  const budget = planDailyUsd(plan);
  let denied: Denial;
  if (budget !== null && (await userSpendToday(user.id)) >= budget) denied = "spend";
  else if (plan === "free" && (await siteBudgetSpent())) denied = "budget";
  else if (await bump(user.id, kind, planLimit(plan, kind))) return { ...base, paidBy: plan };
  else denied = "limit";

  const need = MIN_CREDITS[kind];
  if (await holdCredits(user.id, need)) return { ...base, paidBy: "credits", held: need };
  return { denied };
}

/** Undoes a charge: the request failed before producing anything. */
export async function refundCharge(c: Charge): Promise<void> {
  if (c.paidBy === "credits") await releaseCredits(c.userId, c.held);
  else await refund(c.userId, c.paidBy === "byok" ? "byok" : c.kind);
}

/**
 * Records what a request cost and, if it was paid with credits, takes the
 * rest of its price. With `failed` the charge is refunded instead (the cost,
 * if any, is still recorded). Never throws: the answer is already given.
 */
export async function settleCharge(c: Charge, costs: CostEntry[], failed = false): Promise<void> {
  try {
    let credits = 0;
    if (failed) {
      await refundCharge(c);
    } else if (c.paidBy === "credits") {
      const total = creditsFor(c.kind, costs.reduce((sum, e) => sum + e.usd, 0));
      credits = c.held + (await takeCredits(c.userId, total - c.held));
    }
    await recordCosts(c.userId, c.paidBy, costs, credits);
  } catch (err) {
    console.error("[usage] failed to settle a charge", c.paidBy, c.kind, err);
  }
}

const NOT_IN_PLAN: Record<UsageKind, string> = {
  chat: "Сообщения не входят",
  image: "Изображения не входят",
  video: "Видео не входит",
  voice: "Голосовой ввод не входит",
};

/** Error body for a refused request; `code` lets the UI offer plans and credits. */
export async function deniedResponse(user: SessionUser, kind: UsageKind, denied: Denial): Promise<Response> {
  if (denied === "ownKey") {
    return Response.json(
      { error: `Со своим ключом можно до ${OWN_KEY_DAILY} запросов в сутки. Лимит обновится в полночь по UTC.`, code: "limit" },
      { status: 429 },
    );
  }
  const { plan } = await currentPlan(user.id);
  // Only what this site can actually offer: credits need a payment method.
  const ways = [
    ...(yookassaConfigured() || stripeCreditsConfigured() ? ["купите кредиты"] : []),
    ...(plan === "free" ? ["оформите Pro"] : []),
    "подключите свой ключ OpenRouter в настройках",
  ];
  const hint = `Чтобы продолжить сейчас, ${ways.join(", ").replace(/, ([^,]*)$/, " или $1")}.`;
  let error: string;
  if (denied === "spend") {
    error =
      "Дневной бюджет вашего тарифа на ИИ израсходован: дорогие модели, большие файлы и видео тратят его быстрее. " +
      `Он обновится в полночь по UTC. ${hint}`;
  } else if (denied === "budget") {
    error = `Бесплатные запросы на сегодня закончились: сайт исчерпал дневной бюджет. Попробуйте после полуночи по UTC. ${hint}`;
  } else {
    const limit = (await dailyLimit(user, kind)) ?? 0;
    error =
      limit === 0
        ? `${NOT_IN_PLAN[kind]} в ваш тариф. ${hint}`
        : `Дневной лимит исчерпан (${LIMIT_NAMES[kind]}: ${limit} в сутки). Лимит обновится в полночь по UTC. ${hint}`;
  }
  return Response.json({ error, code: "limit" }, { status: 429 });
}
