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

/** Adds one month to a date, keeping the day of month where possible (Jan 31 → Feb 28). */
export function addMonth(from: Date): Date {
  const next = new Date(from);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}
