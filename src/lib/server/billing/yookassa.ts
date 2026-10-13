// YooKassa (ЮKassa): cards, SBP and SberPay for Russia. The first payment
// saves the payment method; later months are charged from it by a daily cron.
// Webhooks carry no signature, so we never trust their body: every event is
// confirmed by fetching the payment from the YooKassa API.

import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { SessionUser } from "../auth";
import { getDb, schema } from "../db";
import { HttpError } from "../errors";
import { addMonth, getSubscription, isEntitled, proPriceRub } from "./plans";

interface YkPayment {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  paid: boolean;
  amount: { value: string; currency: string };
  confirmation?: { type: string; confirmation_url?: string };
  payment_method?: { id: string; saved: boolean; type: string; title?: string };
  metadata?: Record<string, string>;
  cancellation_details?: { party: string; reason: string };
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Decline reasons after which the saved payment method must not be charged
 * again (the bank revoked permission, the card is gone…). Others — e.g.
 * insufficient_funds — are retried on the following days.
 */
const PERMANENT_DECLINES = new Set([
  "permission_revoked",
  "card_expired",
  "payment_method_restricted",
  "invalid_card_number",
  "invalid_csc",
  "fraud_suspected",
  "country_forbidden",
]);
/** Renewals are attempted from a day before the period ends… */
const CHARGE_AHEAD_MS = DAY;
/** …and retried daily for a few days after a failure. */
const RETRY_WINDOW_MS = 3 * DAY;

export function yookassaConfigured(): boolean {
  return Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
}

export function yookassaPriceLabel(): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(
    proPriceRub(),
  );
}

async function yk<T>(path: string, init?: { method: "POST"; body: unknown; idempotenceKey: string }): Promise<T> {
  // YOOKASSA_API_URL points at a local mock for testing.
  const base = process.env.YOOKASSA_API_URL || "https://api.yookassa.ru/v3";
  const auth = Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString("base64");
  const res = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      ...(init ? { "Content-Type": "application/json", "Idempotence-Key": init.idempotenceKey } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { description?: string } | null;
    throw new HttpError(res.status, `ЮKassa: ${detail?.description ?? res.statusText}`);
  }
  return (await res.json()) as T;
}

function amount() {
  return { value: proPriceRub().toFixed(2), currency: "RUB" };
}

const DESCRIPTION = "Подписка Nexus AI Pro на 1 месяц";

/**
 * Fiscal receipt (54-ФЗ). Needed when the shop sends receipts through
 * YooKassa (YOOKASSA_RECEIPTS=true); the VAT code comes from YOOKASSA_VAT_CODE
 * (1 = без НДС).
 */
function receipt(email: string) {
  if (process.env.YOOKASSA_RECEIPTS !== "true") return {};
  const vat = Number.parseInt(process.env.YOOKASSA_VAT_CODE ?? "1", 10);
  return {
    receipt: {
      customer: { email },
      items: [
        {
          description: DESCRIPTION,
          quantity: 1,
          amount: amount(),
          vat_code: Number.isFinite(vat) ? vat : 1,
          payment_mode: "full_payment",
          payment_subject: "service",
        },
      ],
    },
  };
}

/** Creates the first payment (saving the card for autopay) and returns the payment page URL. */
export async function startYooKassaCheckout(user: SessionUser, origin: string): Promise<string> {
  const sub = await getSubscription(user.id);
  // A promo period can be topped up: the paid month starts when it ends.
  if (isEntitled(sub) && sub?.provider !== "promo") throw new Error("У вас уже есть Pro");

  const payment = await yk<YkPayment>("/payments", {
    method: "POST",
    idempotenceKey: crypto.randomUUID(),
    body: {
      amount: amount(),
      capture: true,
      confirmation: { type: "redirect", return_url: `${origin}/settings?billing=return` },
      save_payment_method: true,
      description: DESCRIPTION,
      metadata: { userId: user.id, kind: "initial" },
      ...receipt(user.email),
    },
  });
  const db = await getDb();
  await db.insert(schema.payment).values({
    id: payment.id,
    userId: user.id,
    kind: "initial",
    status: payment.status,
    amount: payment.amount.value,
    currency: payment.amount.currency,
  });
  const url = payment.confirmation?.confirmation_url;
  if (!url) throw new Error("ЮKassa не вернула ссылку на оплату");
  return url;
}

/**
 * Records the state of one of our payments, as read from the YooKassa API.
 * A successful payment extends Pro by a month exactly once, however many
 * times its notification arrives.
 */
async function applyPayment(p: YkPayment): Promise<void> {
  const db = await getDb();
  const [row] = await db.select().from(schema.payment).where(eq(schema.payment.id, p.id));
  if (!row) return; // not created by us
  if (p.metadata?.userId && p.metadata.userId !== row.userId) {
    console.error("[yookassa] payment user mismatch", p.id);
    return;
  }

  await db.update(schema.payment).set({ status: p.status }).where(eq(schema.payment.id, p.id));

  if (p.status === "succeeded") {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(schema.payment)
        .set({ appliedAt: new Date() })
        .where(and(eq(schema.payment.id, p.id), isNull(schema.payment.appliedAt)))
        .returning();
      if (!claimed) return; // already applied

      const [sub] = await tx
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.userId, row.userId))
        .for("update");
      const now = new Date();
      // Extend from the end of the current period if it's still running, so
      // paying early (or a renewal charged a day ahead) loses nothing.
      const start = isEntitled(sub, now) && sub ? sub.currentPeriodEnd : now;
      const values = {
        plan: "pro" as const,
        provider: "yookassa" as const,
        status: "active",
        currentPeriodEnd: addMonth(start),
        // A new first payment turns autopay (back) on; renewals keep the user's choice.
        cancelAtPeriodEnd: row.kind === "renewal" ? (sub?.cancelAtPeriodEnd ?? false) : false,
        yookassaPaymentMethodId:
          p.payment_method?.saved ? p.payment_method.id : (sub?.yookassaPaymentMethodId ?? null),
        updatedAt: now,
      };
      await tx
        .insert(schema.subscription)
        .values({ userId: row.userId, ...values })
        .onConflictDoUpdate({ target: schema.subscription.userId, set: values });
    });
  } else if (p.status === "canceled" && row.kind === "renewal") {
    // Pro keeps working until the paid period ends; the UI asks to pay again.
    // After a permanent decline the saved method is dropped so it's never retried.
    const permanent = PERMANENT_DECLINES.has(p.cancellation_details?.reason ?? "");
    await db
      .update(schema.subscription)
      .set({ status: "past_due", ...(permanent ? { yookassaPaymentMethodId: null } : {}), updatedAt: new Date() })
      .where(and(eq(schema.subscription.userId, row.userId), eq(schema.subscription.provider, "yookassa")));
  }
}

async function fetchAndApply(paymentId: string): Promise<YkPayment> {
  const payment = await yk<YkPayment>(`/payments/${encodeURIComponent(paymentId)}`);
  await applyPayment(payment);
  return payment;
}

/** Handles a YooKassa HTTP notification. Returns an HTTP status. */
export async function handleYooKassaWebhook(body: unknown): Promise<number> {
  const object = (body as { object?: { id?: unknown } } | null)?.object;
  if (typeof object?.id !== "string" || !/^[\w-]{10,64}$/.test(object.id)) return 400;
  const db = await getDb();
  const [row] = await db.select({ id: schema.payment.id }).from(schema.payment).where(eq(schema.payment.id, object.id));
  // Refunds and payments we didn't create are acknowledged and ignored.
  if (row) await fetchAndApply(object.id);
  return 200;
}

/** Back from the payment page: confirm the user's latest payment right away. */
export async function syncLatestYooKassaPayment(userId: string): Promise<"succeeded" | "pending" | "failed"> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.payment)
    .where(eq(schema.payment.userId, userId))
    .orderBy(desc(schema.payment.createdAt))
    .limit(1);
  if (!row) return "failed";
  const payment = await fetchAndApply(row.id);
  if (payment.status === "succeeded") return "succeeded";
  return payment.status === "canceled" ? "failed" : "pending";
}

export async function setAutoRenew(userId: string, enabled: boolean): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(schema.subscription)
    .set({ cancelAtPeriodEnd: !enabled, updatedAt: new Date() })
    .where(
      and(
        eq(schema.subscription.userId, userId),
        eq(schema.subscription.provider, "yookassa"),
        ...(enabled ? [sql`${schema.subscription.yookassaPaymentMethodId} is not null`] : []),
      ),
    )
    .returning({ userId: schema.subscription.userId });
  return rows.length > 0;
}

/**
 * Charges subscriptions that are about to end (or ended within the retry
 * window) from their saved payment method. Safe to run several times a day:
 * each subscription gets at most one attempt per UTC day, and YooKassa
 * deduplicates by Idempotence-Key.
 */
export async function chargeRenewals(now = new Date()): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const db = await getDb();
  const due = await db
    .select({ sub: schema.subscription, email: schema.user.email })
    .from(schema.subscription)
    .innerJoin(schema.user, eq(schema.user.id, schema.subscription.userId))
    .where(
      and(
        eq(schema.subscription.provider, "yookassa"),
        inArray(schema.subscription.status, ["active", "past_due"]),
        eq(schema.subscription.cancelAtPeriodEnd, false),
        sql`${schema.subscription.yookassaPaymentMethodId} is not null`,
        lte(schema.subscription.currentPeriodEnd, new Date(now.getTime() + CHARGE_AHEAD_MS)),
        gt(schema.subscription.currentPeriodEnd, new Date(now.getTime() - RETRY_WINDOW_MS)),
      ),
    )
    .limit(200);

  const today = now.toISOString().slice(0, 10);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const { sub, email } of due) {
    // One attempt per day; never while another renewal is still processing.
    const [recent] = await db
      .select({ id: schema.payment.id })
      .from(schema.payment)
      .where(
        and(
          eq(schema.payment.userId, sub.userId),
          eq(schema.payment.kind, "renewal"),
          or(
            inArray(schema.payment.status, ["pending", "waiting_for_capture"]),
            gt(schema.payment.createdAt, new Date(now.getTime() - 20 * 60 * 60 * 1000)),
          ),
        ),
      )
      .limit(1);
    if (recent) continue;

    attempted++;
    try {
      const payment = await yk<YkPayment>("/payments", {
        method: "POST",
        idempotenceKey: `renew-${sub.userId}-${sub.currentPeriodEnd.getTime()}-${today}`,
        body: {
          amount: amount(),
          capture: true,
          payment_method_id: sub.yookassaPaymentMethodId,
          description: DESCRIPTION,
          metadata: { userId: sub.userId, kind: "renewal" },
          ...receipt(email),
        },
      });
      await db
        .insert(schema.payment)
        .values({
          id: payment.id,
          userId: sub.userId,
          kind: "renewal",
          status: payment.status,
          amount: payment.amount.value,
          currency: payment.amount.currency,
        })
        .onConflictDoNothing();
      await applyPayment(payment);
      if (payment.status === "succeeded") succeeded++;
      else if (payment.status === "canceled") failed++;
    } catch (err) {
      failed++;
      console.error("[yookassa] renewal failed", sub.userId, err);
    }
  }
  return { attempted, succeeded, failed };
}
