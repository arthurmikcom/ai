// One-off purchases (PayPal, TON): a month of a plan or a pack of credits,
// paid once, with nothing renewing by itself. Each is recorded when checkout
// starts and applied exactly once, whichever check sees the money first.

import { and, eq, isNull } from "drizzle-orm";
import { PLAN_NAMES } from "@/lib/plans";
import type { PaidPlanId } from "@/lib/types";
import { getDb, schema, type DB } from "../db";
import { creditPacks, grantCredits, type PackDef } from "./credits";
import { addMonth, isEntitled, planPriceSetting, renewingBlock, subscriptionPlan, type SubscriptionRow } from "./plans";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type PurchaseRow = typeof schema.purchase.$inferSelect;
export type OneOffProvider = "paypal" | "ton";

/** What is bought: a month of a plan, or a pack of credits. */
export type OneOffItem = { plan: PaidPlanId } | { pack: PackDef };

/** The item's price in US dollars, or why it isn't sold. */
export function oneOffPrice(item: OneOffItem): number | string {
  if ("pack" in item) return item.pack.usd > 0 ? item.pack.usd : "Этот пакет не продаётся в долларах";
  const { usd } = planPriceSetting(item.plan);
  return usd > 0 ? usd : `${PLAN_NAMES[item.plan]} сейчас не продаётся`;
}

/** Why the user can't buy a month of a plan this way now (a subscription that renews by itself), or null. */
export function oneOffBlock(sub: SubscriptionRow | undefined, item: OneOffItem | PurchaseRow): string | null {
  const plan = "kind" in item ? item.kind === "plan" : "plan" in item;
  return plan ? renewingBlock(sub) : null;
}

/** What the purchase is, in words (PayPal's order line, the TON page). */
export function oneOffTitle(row: Pick<PurchaseRow, "kind" | "plan" | "credits">): string {
  return row.kind === "credits" ? `${row.credits} кредитов MARYX Ai` : `MARYX Ai ${PLAN_NAMES[row.plan ?? "pro"]} на 1 месяц`;
}

export async function createPurchase(
  userId: string,
  provider: OneOffProvider,
  item: OneOffItem,
  usd: number,
  ask: { amount: string; currency: "USD" | "TON"; code?: string; expiresAt?: Date },
): Promise<PurchaseRow> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.purchase)
    .values({
      id: crypto.randomUUID(),
      userId,
      provider,
      kind: "pack" in item ? "credits" : "plan",
      plan: "plan" in item ? item.plan : null,
      credits: "pack" in item ? item.pack.credits : null,
      usd: usd.toFixed(2),
      amount: ask.amount,
      currency: ask.currency,
      code: ask.code ?? null,
      status: "pending",
      expiresAt: ask.expiresAt ?? null,
    })
    .returning();
  return row;
}

/** A plan's price for comparing what's left of one period with another (unsold plans count as equal). */
function planValue(plan: PaidPlanId): number {
  return planPriceSetting(plan).usd;
}

/**
 * A month of `plan` for the user. The same plan still running is extended
 * from its end; another plan's remaining days are kept, converted at the new
 * plan's price (two weeks of Plus become one week of Ultra and so on).
 * Returns false when a subscription that renews by itself appeared meanwhile.
 */
async function addPlanMonth(tx: Tx, userId: string, plan: PaidPlanId, provider: OneOffProvider): Promise<boolean> {
  const [sub] = await tx.select().from(schema.subscription).where(eq(schema.subscription.userId, userId)).for("update");
  if (renewingBlock(sub)) return false;
  const now = new Date();
  const running = sub && isEntitled(sub, now) ? sub : undefined;
  let end: Date;
  if (running && subscriptionPlan(running) === plan) {
    end = addMonth(running.currentPeriodEnd);
  } else {
    end = addMonth(now);
    if (running) {
      const [from, to] = [planValue(subscriptionPlan(running)), planValue(plan)];
      const ratio = from > 0 && to > 0 ? from / to : 1;
      end = new Date(end.getTime() + Math.max(0, running.currentPeriodEnd.getTime() - now.getTime()) * ratio);
    }
  }
  const values = {
    plan,
    provider,
    status: "active",
    currentPeriodEnd: end,
    // Nothing to renew: the next month is paid again.
    cancelAtPeriodEnd: true,
    anchorDay: null,
    // Checked above: neither is billing any more.
    stripeSubscriptionId: null,
    paddleSubscriptionId: null,
    updatedAt: now,
  };
  await tx
    .insert(schema.subscription)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.subscription.userId, set: values });
  return true;
}

/** Credits worth `usd` at the best pack's rate (a plan paid for while another subscription started). */
function creditsWorth(usd: number): number {
  const rates = creditPacks().filter((p) => p.usd > 0).map((p) => p.credits / p.usd);
  return Math.max(1, Math.floor(usd * (rates.length ? Math.max(...rates) : 200)));
}

/**
 * Applies a paid purchase once: the plan's month or the credits. `externalId`
 * is saved with it (a TON transaction's hash). Returns false when it had
 * already been applied.
 */
export async function applyPurchase(id: string, externalId?: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.purchase)
      .set({ status: "paid", appliedAt: new Date(), ...(externalId ? { externalId } : {}) })
      .where(and(eq(schema.purchase.id, id), isNull(schema.purchase.appliedAt)))
      .returning();
    if (!row) return false;
    const grant = { id: `${row.provider}:${row.id}`, userId: row.userId, source: row.provider };
    if (row.kind === "credits") {
      await grantCredits({ ...grant, credits: row.credits ?? 0 }, tx);
    } else if (!(await addPlanMonth(tx, row.userId, row.plan ?? "pro", row.provider))) {
      // Paid while a subscription that renews by itself started elsewhere: the money isn't lost.
      console.warn("[billing] plan paid during a live subscription, credited instead", row.id);
      await grantCredits({ ...grant, credits: creditsWorth(Number(row.usd)), note: `${oneOffTitle(row)}: оплачено при действующей подписке` }, tx);
    }
    return true;
  });
}

/** The user's own purchase. */
export async function findPurchase(userId: string, id: string): Promise<PurchaseRow | undefined> {
  if (!/^[\w-]{10,64}$/.test(id)) return undefined;
  const db = await getDb();
  const [row] = await db.select().from(schema.purchase).where(and(eq(schema.purchase.id, id), eq(schema.purchase.userId, userId)));
  return row;
}

export async function setPurchaseStatus(id: string, status: "failed" | "expired"): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.purchase)
    .set({ status })
    .where(and(eq(schema.purchase.id, id), eq(schema.purchase.status, "pending")));
}
