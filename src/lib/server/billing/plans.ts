import { eq } from "drizzle-orm";
import type { PlanId, UsageKind } from "@/lib/types";
import { getDb, schema } from "../db";

export type SubscriptionRow = typeof schema.subscription.$inferSelect;

const DEFAULT_LIMITS: Record<PlanId, Record<UsageKind, number>> = {
  free: { chat: 50, image: 10, video: 2 },
  pro: { chat: 500, image: 100, video: 10 },
};

const ENV_PREFIX: Record<PlanId, string> = { free: "FREE_DAILY_", pro: "PRO_DAILY_" };

/** Daily limit of a plan from env (FREE_DAILY_CHAT, PRO_DAILY_IMAGE…); null = unlimited. */
export function planLimit(plan: PlanId, kind: UsageKind): number | null {
  const raw = process.env[`${ENV_PREFIX[plan]}${kind.toUpperCase()}`]?.trim();
  if (raw === "unlimited") return null;
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_LIMITS[plan][kind];
}

/** Monthly Pro price in roubles for YooKassa (PRO_PRICE_RUB, default 990). */
export function proPriceRub(): number {
  const value = Number.parseFloat(process.env.PRO_PRICE_RUB ?? "");
  return Number.isFinite(value) && value > 0 ? value : 990;
}

/** Whether a subscription currently grants Pro. */
export function isEntitled(sub: SubscriptionRow | undefined, now = new Date()): boolean {
  if (!sub || sub.currentPeriodEnd <= now) return false;
  // Stripe tells us when a payment failed; our own subscriptions just run to the period end.
  return sub.provider === "stripe" ? sub.status === "active" || sub.status === "trialing" : sub.status !== "canceled";
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(schema.subscription).where(eq(schema.subscription.userId, userId));
  return row;
}

export async function currentPlan(userId: string): Promise<{ plan: PlanId; sub?: SubscriptionRow }> {
  const sub = await getSubscription(userId);
  return { plan: isEntitled(sub) ? "pro" : "free", sub };
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
