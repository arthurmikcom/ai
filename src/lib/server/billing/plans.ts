import { eq } from "drizzle-orm";
import { isPaidPlan } from "@/lib/plans";
import type { PaidPlanId, PlanId, UsageKind } from "@/lib/types";
import { getDb, schema } from "../db";

export type SubscriptionRow = typeof schema.subscription.$inferSelect;

const DEFAULT_LIMITS: Record<PlanId, Record<UsageKind, number>> = {
  // Video costs dollars per clip, so by default it's for paid plans (or paid with credits).
  free: { chat: 20, image: 3, video: 0, voice: 20 },
  plus: { chat: 150, image: 30, video: 3, voice: 100 },
  pro: { chat: 500, image: 100, video: 10, voice: 300 },
  ultra: { chat: 2000, image: 300, video: 30, voice: 1000 },
};

/** "FREE", "PLUS", "PRO", "ULTRA": the start of a plan's settings (FREE_DAILY_CHAT, ULTRA_PRICE_USD…). */
export function planEnv(plan: PlanId): string {
  return plan.toUpperCase();
}

/** Daily limit of a plan from env (FREE_DAILY_CHAT, PRO_DAILY_IMAGE…); null = unlimited. */
export function planLimit(plan: PlanId, kind: UsageKind): number | null {
  const raw = process.env[`${planEnv(plan)}_DAILY_${kind.toUpperCase()}`]?.trim();
  if (raw === "unlimited") return null;
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_LIMITS[plan][kind];
}

/** Monthly Pro price in roubles for YooKassa (PRO_PRICE_RUB, default 990). */
export function proPriceRub(): number {
  const value = Number.parseFloat(process.env.PRO_PRICE_RUB ?? "");
  return Number.isFinite(value) && value > 0 ? value : 990;
}

/** Monthly prices in US dollars by default (PLUS_PRICE_USD, PRO_PRICE_USD, ULTRA_PRICE_USD). */
const DEFAULT_PRICE_USD: Record<PaidPlanId, number> = { plus: 4.99, pro: 9.99, ultra: 24.99 };

/**
 * A plan's monthly price in US dollars (its *_PRICE_USD). 0 doesn't sell it.
 * A value that isn't a price Stripe takes ("9.99" or "9,99", at least $0.50)
 * is `invalid`: the plan then isn't sold rather than at a wrong amount, and
 * the setup check says so.
 */
export function planPriceSetting(plan: PaidPlanId): { usd: number; invalid?: string } {
  const raw = process.env[`${planEnv(plan)}_PRICE_USD`]?.trim();
  if (!raw) return { usd: DEFAULT_PRICE_USD[plan] };
  const text = raw.replace(",", ".");
  const value = Number(text);
  if (!/^\d+(\.\d{1,2})?$/.test(text) || (value > 0 && value < 0.5)) return { usd: 0, invalid: raw };
  return { usd: value };
}

/** The plan a subscription row is for (rows from before Plus and Ultra are Pro). */
export function subscriptionPlan(sub: Pick<SubscriptionRow, "plan">): PaidPlanId {
  return isPaidPlan(sub.plan) ? sub.plan : "pro";
}

/** Whether a subscription currently grants its paid plan. */
export function isEntitled(sub: SubscriptionRow | undefined, now = new Date()): boolean {
  if (!sub || sub.currentPeriodEnd <= now) return false;
  // Stripe and Paddle tell us when a payment failed; our own periods just run to the period end.
  return sub.provider === "stripe" || sub.provider === "paddle"
    ? sub.status === "active" || sub.status === "trialing"
    : sub.status !== "canceled";
}

/** PayPal and TON pay for one month at a time: nothing renews by itself. */
export function isOneOff(provider: string | undefined): provider is "paypal" | "ton" {
  return provider === "paypal" || provider === "ton";
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.subscription).where(eq(schema.subscription.userId, userId));
  return row;
}

export async function currentPlan(userId: string): Promise<{ plan: PlanId; sub?: SubscriptionRow }> {
  const sub = await getSubscription(userId);
  return { plan: sub && isEntitled(sub) ? subscriptionPlan(sub) : "free", sub };
}

/**
 * Adds one month, landing on `anchorDay` where the month has it: with anchor
 * 31, Jan 31 → Feb 28 → Mar 31 (not Mar 28), so short months don't make the
 * billing date drift.
 */
export function addMonth(from: Date, anchorDay = from.getUTCDate()): Date {
  const next = new Date(from);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(anchorDay, lastDay));
  return next;
}

/**
 * A YooKassa period that can't renew on its own (the renewal was declined, or
 * there's no saved card): the user may pay again, and the new month starts
 * when the current one ends.
 */
export function needsYooKassaRepay(sub: SubscriptionRow | undefined): boolean {
  return sub?.provider === "yookassa" && (sub.status === "past_due" || !sub.yookassaPaymentMethodId);
}

/** Stripe statuses in which the subscription still exists and may bill the card. */
const STRIPE_LIVE = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

export function isLiveStripe(status: string): boolean {
  return STRIPE_LIVE.has(status);
}

/**
 * A Stripe subscription that is still billing (even if a payment failed).
 * While it exists we don't start another subscription or a YooKassa/promo
 * period, or the user could end up paying twice.
 */
export function hasLiveStripe(sub: SubscriptionRow | undefined): boolean {
  return sub?.provider === "stripe" && Boolean(sub.stripeSubscriptionId) && isLiveStripe(sub.status);
}

/** Paddle statuses in which the subscription still exists and may bill. */
const PADDLE_LIVE = new Set(["active", "trialing", "past_due", "paused"]);

export function isLivePaddle(status: string): boolean {
  return PADDLE_LIVE.has(status);
}

/** A Paddle subscription that is still billing: plans change in place, nothing else is started on top. */
export function hasLivePaddle(sub: SubscriptionRow | undefined): boolean {
  return sub?.provider === "paddle" && Boolean(sub.paddleSubscriptionId) && isLivePaddle(sub.status);
}

/**
 * Why a period that renews by itself (Stripe, Paddle, YooKassa with autopay)
 * blocks another purchase on top of it, or null when there's none.
 */
export function renewingBlock(sub: SubscriptionRow | undefined): string | null {
  if (hasLiveStripe(sub) || hasLivePaddle(sub)) {
    return "У вас подписка с автопродлением — сменить тариф можно на странице тарифов, а управлять ею в настройках («Управлять подпиской»)";
  }
  if (sub?.provider === "yookassa" && isEntitled(sub) && sub.yookassaPaymentMethodId && !sub.cancelAtPeriodEnd) {
    return "У вас подписка в рублях с автопродлением — сначала отключите автопродление в настройках";
  }
  return null;
}
