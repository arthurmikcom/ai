import { and, eq, sql } from "drizzle-orm";
import { USAGE_KINDS, type PaidBy, type UsageKind, type UsageSummary } from "@/lib/types";
import { isAdmin, type SessionUser } from "./auth";
import {
  creditBalance,
  creditsFor,
  creditValueUsd,
  holdCredits,
  holdUpTo,
  MIN_CREDITS,
  releaseCredits,
  takeCredits,
} from "./billing/credits";
import { currentPlan, planLimit } from "./billing/plans";
import { sellablePacks } from "./billing/packs";
import { getDb, schema } from "./db";
import {
  BUDGETED,
  freeSpendToday,
  insertReservation,
  planDailyUsd,
  recordCosts,
  siteBudgetSpent,
  siteDailyBudget,
  userSpendToday,
  type CostEntry,
} from "./spend";

/** Today's limit for this user; null means unlimited. */
export async function dailyLimit(user: SessionUser, kind: UsageKind): Promise<number | null> {
  if (isAdmin(user)) return null;
  const { plan } = await currentPlan(user.id);
  return planLimit(plan, kind);
}

export function today(): string {
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

/** Gives back a use when the provider failed before producing anything — on the day it was counted. */
export async function refund(userId: string, kind: Counter, day = today()): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.usage)
    .set({ count: sql`greatest(${schema.usage.count} - 1, 0)` })
    .where(
      and(
        eq(schema.usage.userId, userId),
        eq(schema.usage.day, day),
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
 * How one request is paid for. With the user's own OpenRouter key it costs the
 * site nothing. Otherwise it counts toward the plan's daily limit, within the
 * plan's daily budget for chat and dictation (expensive models and big files
 * use it up faster) and, for free requests, the site-wide daily budget. Past
 * any of those it is paid with credits, if the user has enough.
 *
 * It happens in two steps: charge() before the request is prepared (counts,
 * and the least credits it can take), then reserve() with its estimated cost
 * once the model and input are known. The estimate is held while the request
 * runs — in the ledger as a pending row, and from the credit balance — so
 * parallel requests can't slip past a budget or spend credits twice.
 * settleCharge() replaces it with the real cost.
 */
export interface Charge {
  /** Also the id of the pending ledger row holding the estimate. */
  id: string;
  userId: string;
  kind: UsageKind;
  paidBy: PaidBy;
  /** Credits held (paidBy "credits"); the real cost is settled at the end. */
  held: number;
  /** The user's own OpenRouter key (paidBy "byok"). */
  key?: string;
  /** UTC day the use was counted on. */
  day: string;
  /** Credits the request was estimated to need, when there weren't enough. */
  need?: number;
  /**
   * USD the request may spend, when the budget or credits cover less than its
   * full price: a chat answer is limited to what this pays for.
   */
  allowance?: number;
  /** Settled or refunded already; later calls do nothing. */
  done?: boolean;
}

/**
 * Why a request was refused: the plan's count limit, the user's daily budget
 * (used up, or not enough left for this request), the site's budget for free
 * requests, not enough credits for this request, or the daily count for
 * one's own key.
 */
export type Denial = "limit" | "spend" | "expensive" | "budget" | "credits" | "ownKey";

/** Requests a day with one's own key: no cost to the site, but the server still does the work. */
const OWN_KEY_DAILY = 3000;

const budgeted = (kind: UsageKind) => BUDGETED.includes(kind);

export async function charge(user: SessionUser, kind: UsageKind, ownKey?: string): Promise<Charge | { denied: Denial }> {
  const base = { id: crypto.randomUUID(), userId: user.id, kind, held: 0, day: today() };
  if (ownKey) {
    return (await bump(user.id, "byok", OWN_KEY_DAILY)) ? { ...base, paidBy: "byok", key: ownKey } : { denied: "ownKey" };
  }
  if (isAdmin(user)) {
    await bump(user.id, kind, null);
    return { ...base, paidBy: "admin" };
  }
  const { plan } = await currentPlan(user.id);
  const budget = budgeted(kind) ? planDailyUsd(plan) : null;
  let denied: Denial;
  if (budget !== null && (await userSpendToday(user.id)) >= budget) denied = "spend";
  else if (plan === "free" && (await siteBudgetSpent())) denied = "budget";
  else if (await bump(user.id, kind, planLimit(plan, kind))) return { ...base, paidBy: plan };
  else denied = "limit";

  const need = MIN_CREDITS[kind];
  if (await holdCredits(user.id, need)) return { ...base, paidBy: "credits", held: need };
  return { denied };
}

/**
 * Holds what a request may cost (USD) while it runs. `most` is its price at
 * full size; `least` (for a chat answer, its input plus a short answer) is
 * the smallest it is worth running at. When the plan's budget, the site's
 * budget or the credits can't cover `most`, the request runs within what they
 * do cover — `c.allowance` says how much, so the answer is limited to it — or,
 * below `least`, it is refused. A plan-paid request over a budget switches to
 * credits if the user has some. Returns the reason when refused (the charge is
 * then still to be refunded by the caller).
 */
export async function reserve(
  c: Charge,
  cost: number | { most: number; least: number },
  call: { provider: string; model: string },
): Promise<Denial | null> {
  if (c.done || c.paidBy === "byok" || c.paidBy === "admin") return null;
  const clean = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const most = clean(typeof cost === "number" ? cost : cost.most);
  const least = Math.min(most, clean(typeof cost === "number" ? cost : cost.least));
  const row = { id: c.id, userId: c.userId, kind: c.kind, provider: call.provider, model: call.model };

  if (c.paidBy !== "credits") {
    const verdict = await reservePlan(c.paidBy, { ...row, most, least }, c);
    if (!verdict) return null;
    // Over a budget: credits can still pay, and the plan's use is given back.
    const balance = await creditBalance(c.userId);
    if (balance < creditsFor(c.kind, least)) return verdict;
    await refund(c.userId, c.kind, c.day);
    c.paidBy = "credits";
    c.held = 0;
  }

  // Credits: hold the full price if the balance has it, else whatever it has, if that's enough.
  const want = creditsFor(c.kind, most);
  if (want > c.held) c.held += await holdUpTo(c.userId, want - c.held);
  const need = creditsFor(c.kind, least);
  if (c.held < need) {
    c.need = need;
    return "credits";
  }
  const covered = c.held * creditValueUsd();
  if (covered < most) c.allowance = covered;
  await insertReservation(await getDb(), { ...row, usd: Math.min(most, covered), paidBy: "credits" });
  return null;
}

/**
 * Checks a plan-paid request against the plan's and the site's budgets and
 * reserves what fits (`most`, or what's left of the budgets if that is at
 * least `least`). One request of a user at a time (and, with a site budget,
 * one free request at a time), so parallel ones see each other.
 */
async function reservePlan(
  plan: "free" | "pro",
  row: { id: string; userId: string; kind: UsageKind; provider: string; model: string; most: number; least: number },
  c: Charge,
): Promise<Denial | null> {
  const site = plan === "free" ? siteDailyBudget() : null;
  const budget = budgeted(row.kind) ? planDailyUsd(plan) : null;
  const db = await getDb();
  return db.transaction(async (tx): Promise<Denial | null> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`maryx-spend:${row.userId}`}))`);
    if (site !== null) await tx.execute(sql`select pg_advisory_xact_lock(hashtext('maryx-spend:site-free'))`);
    let room = Infinity;
    let short: Denial = "expensive";
    if (budget !== null) {
      const spent = await userSpendToday(row.userId, tx);
      room = budget - spent;
      if (room <= 0) return "spend";
    }
    if (site !== null) {
      const siteRoom = site - (await freeSpendToday(tx));
      if (siteRoom <= 0) return "budget";
      if (siteRoom < room) {
        room = siteRoom;
        short = "budget";
      }
    }
    if (room < row.least) return short;
    const usd = Math.min(row.most, room);
    if (usd < row.most) c.allowance = usd;
    await insertReservation(tx, { ...row, usd, paidBy: plan });
    return null;
  });
}

/** Undoes a charge: the request failed before producing anything. */
export async function refundCharge(c: Charge): Promise<void> {
  await settleCharge(c, [], true);
}

/**
 * Records what a request cost, replacing its reservation, and settles its
 * credits: the unused part of the hold goes back, a cost above it is taken
 * (even into debt). With `failed` the charge is refunded instead (a cost the
 * provider billed anyway is still recorded). Runs once per charge; never
 * throws, since the answer has already been given.
 */
export async function settleCharge(c: Charge, costs: CostEntry[], failed = false): Promise<void> {
  if (c.done) return;
  c.done = true;
  try {
    let credits = 0;
    if (failed) {
      if (c.paidBy === "credits") await releaseCredits(c.userId, c.held);
      else await refund(c.userId, c.paidBy === "byok" ? "byok" : c.kind, c.day);
    } else if (c.paidBy === "credits") {
      const total = creditsFor(c.kind, costs.reduce((sum, e) => sum + e.usd, 0));
      if (total > c.held) await takeCredits(c.userId, total - c.held);
      else await releaseCredits(c.userId, c.held - total);
      credits = total;
    }
    await recordCosts(c.userId, c.paidBy, costs, credits, { chargeId: c.id, kind: c.kind });
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

/**
 * Error body for a refused request. `code` "limit" lets the UI offer plans and
 * credits; "own-key-limit" (the daily count for one's own key) can't be lifted by them.
 * `c` is the refused charge, when there was one (for the credits it needed).
 */
export async function deniedResponse(
  user: SessionUser,
  kind: UsageKind,
  denied: Denial,
  opts: { ownKey?: boolean; charge?: Charge } = {},
): Promise<Response> {
  if (denied === "ownKey") {
    return Response.json(
      {
        error: `Со своим ключом можно до ${OWN_KEY_DAILY} запросов в сутки. Лимит обновится в полночь по UTC, или удалите ключ в настройках, чтобы пользоваться тарифом сайта.`,
        code: "own-key-limit",
      },
      { status: 429 },
    );
  }
  const { plan } = await currentPlan(user.id);
  // Only what this site can actually offer: credits need a payment method.
  const ways = [
    ...(sellablePacks().length ? ["купите кредиты"] : []),
    ...(plan === "free" ? ["оформите Pro"] : []),
    opts.ownKey
      ? "выберите MARYX или модель OpenRouter — запрос пойдёт по вашему ключу"
      : "подключите свой ключ OpenRouter в настройках",
  ];
  const hint = `Чтобы продолжить сейчас, ${ways.join(", ").replace(/, ([^,]*)$/, " или $1")}.`;
  let error: string;
  if (denied === "spend") {
    error =
      (kind === "voice"
        ? "Дневной бюджет вашего тарифа на ИИ израсходован. "
        : "Дневной бюджет вашего тарифа на ИИ израсходован: дорогие модели и большие файлы тратят его быстрее. ") +
      `Он обновится в полночь по UTC. ${hint}`;
  } else if (denied === "expensive") {
    error =
      kind === "voice"
        ? `Эта запись дороже, чем осталось в дневном бюджете вашего тарифа. Запишите фрагмент покороче. ${hint}`
        : "Этот запрос слишком большой для того, что осталось в дневном бюджете вашего тарифа: длинная переписка или большие файлы. " +
          `Начните новый чат, уберите файлы или выберите модель попроще. ${hint}`;
  } else if (denied === "credits") {
    const balance = await creditBalance(user.id);
    const need = opts.charge?.need;
    error =
      balance < 0
        ? `Предыдущий запрос стоил больше, чем оставалось кредитов: долг ${-balance} кр. Пополните кредиты, чтобы продолжить.`
        : `Не хватает кредитов: этот запрос стоит около ${need ?? "?"}, а у вас ${balance}. Пополните кредиты или выберите модель попроще.`;
  } else if (denied === "budget") {
    error = `Бесплатные запросы на сегодня закончились: сайт исчерпал дневной бюджет. Попробуйте после полуночи по UTC. ${hint}`;
  } else {
    const limit = (await dailyLimit(user, kind)) ?? 0;
    error =
      limit === 0
        ? `${NOT_IN_PLAN[kind]} в ваш тариф. ${hint}`
        : `Дневной лимит исчерпан (${LIMIT_NAMES[kind]}: ${limit} в сутки). Лимит обновится в полночь по UTC. ${hint}`;
  }
  // Credits in debt can't pay for anything until topped up: say so, whatever the reason was.
  if (denied !== "credits") {
    const balance = await creditBalance(user.id);
    if (balance < 0) error += ` Кредитов нет: долг ${-balance} кр. спишется из следующего пополнения.`;
  }
  return Response.json({ error, code: "limit" }, { status: 429 });
}
