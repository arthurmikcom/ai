// YooKassa (ЮKassa): cards, SBP and SberPay for Russia. The first payment
// saves the payment method; later months are charged from it by a daily cron.
// Webhooks carry no signature, so we never trust their body: every event is
// confirmed by fetching the payment from the YooKassa API.

import { createHash } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import type { SessionUser } from "../auth";
import { getDb, schema } from "../db";
import { HttpError } from "../errors";
import { grantCredits, type PackDef } from "./credits";
import { addMonth, getSubscription, hasLiveStripe, isEntitled, needsYooKassaRepay, proPriceRub } from "./plans";

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
/** One new charge attempt per subscription per day. */
const RETRY_EVERY_MS = 20 * 60 * 60 * 1000;
/** An attempt younger than this with no payment yet is still being made by another run. */
const IN_FLIGHT_MS = 10 * 60 * 1000;
/** YooKassa remembers an Idempotence-Key for 24 h; reuse ours only within that. */
const IDEMPOTENCE_TTL_MS = 23 * 60 * 60 * 1000;
/** Stop starting new charges before the cron function's time limit. */
const RUN_BUDGET_MS = 240 * 1000;
/** Hour (UTC) of the daily renewal run — keep in sync with vercel.json. */
const RENEWAL_HOUR_UTC = 6;

/** When the daily run will charge a period ending at `periodEnd`. */
export function nextChargeAt(periodEnd: Date): Date {
  const earliest = periodEnd.getTime() - CHARGE_AHEAD_MS;
  const run = new Date(earliest);
  run.setUTCHours(RENEWAL_HOUR_UTC, 0, 0, 0);
  if (run.getTime() < earliest) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}

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

function amount(rub = proPriceRub()) {
  return { value: rub.toFixed(2), currency: "RUB" };
}

const DESCRIPTION = "Подписка MARYX Ai Pro на 1 месяц";

/**
 * Fiscal receipt (54-ФЗ). Needed when the shop sends receipts through
 * YooKassa (YOOKASSA_RECEIPTS=true); the VAT code comes from YOOKASSA_VAT_CODE
 * (1 = без НДС).
 */
function receipt(email: string, description = DESCRIPTION, price = amount()) {
  if (process.env.YOOKASSA_RECEIPTS !== "true") return {};
  const vat = Number.parseInt(process.env.YOOKASSA_VAT_CODE ?? "1", 10);
  return {
    receipt: {
      customer: { email },
      items: [
        {
          description,
          quantity: 1,
          amount: price,
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
  if (hasLiveStripe(sub)) {
    throw new Error("У вас есть подписка Stripe — обновите карту или отмените её в «Управлять подпиской»");
  }
  // A promo period can be topped up, and so can a YooKassa period that won't
  // renew by itself (declined or no saved card): the paid month starts when it ends.
  if (isEntitled(sub) && sub?.provider !== "promo" && !needsYooKassaRepay(sub)) {
    throw new Error("У вас уже есть Pro");
  }

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
  await recordPayment(payment, user.id, "initial");
  const url = payment.confirmation?.confirmation_url;
  if (!url) throw new Error("ЮKassa не вернула ссылку на оплату");
  return url;
}

/** A one-off payment for a pack of credits; the card isn't saved. Returns the payment page URL. */
export async function startYooKassaCredits(user: SessionUser, origin: string, pack: PackDef): Promise<string> {
  const description = `Пакет ${pack.credits} кредитов MARYX Ai`;
  const payment = await yk<YkPayment>("/payments", {
    method: "POST",
    idempotenceKey: crypto.randomUUID(),
    body: {
      amount: amount(pack.rub),
      capture: true,
      confirmation: { type: "redirect", return_url: `${origin}/settings?billing=return` },
      description,
      metadata: { userId: user.id, kind: "credits", credits: String(pack.credits) },
      ...receipt(user.email, description, amount(pack.rub)),
    },
  });
  await recordPayment(payment, user.id, "credits", pack.credits);
  const url = payment.confirmation?.confirmation_url;
  if (!url) throw new Error("ЮKassa не вернула ссылку на оплату");
  return url;
}

type PaymentKind = "initial" | "renewal" | "credits";

async function recordPayment(p: YkPayment, userId: string, kind: PaymentKind, credits?: number): Promise<void> {
  const db = await getDb();
  await db
    .insert(schema.payment)
    .values({
      id: p.id,
      userId,
      kind,
      status: p.status,
      amount: p.amount.value,
      currency: p.amount.currency,
      credits: credits ?? null,
    })
    .onConflictDoNothing();
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

  // Final statuses never change; a slower, older read must not overwrite them.
  await db
    .update(schema.payment)
    .set({ status: p.status })
    .where(and(eq(schema.payment.id, p.id), notInArray(schema.payment.status, ["succeeded", "canceled"])));

  if (row.kind === "credits") {
    // A pack of credits: added once, never touches the subscription.
    if (p.status !== "succeeded" || !row.credits) return;
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(schema.payment)
        .set({ appliedAt: new Date() })
        .where(and(eq(schema.payment.id, p.id), isNull(schema.payment.appliedAt)))
        .returning();
      if (!claimed) return;
      await grantCredits({ id: `yookassa:${p.id}`, userId: row.userId, credits: row.credits!, source: "yookassa" }, tx);
    });
    return;
  }

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
      const running = isEntitled(sub, now) && sub;
      const start = running ? sub.currentPeriodEnd : now;
      const anchorDay = (running && sub.provider === "yookassa" && sub.anchorDay) || start.getUTCDate();
      const values = {
        plan: "pro" as const,
        provider: "yookassa" as const,
        status: "active",
        currentPeriodEnd: addMonth(start, anchorDay),
        anchorDay,
        // A new first payment turns autopay (back) on; renewals keep the user's choice.
        cancelAtPeriodEnd: row.kind === "renewal" ? (sub?.cancelAtPeriodEnd ?? false) : false,
        yookassaPaymentMethodId:
          p.payment_method?.saved ? p.payment_method.id : (sub?.yookassaPaymentMethodId ?? null),
        // Checkout refuses while a Stripe subscription is live, so any one left here is over.
        stripeSubscriptionId: null,
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
    // Only for the card that was declined: a late notice must not touch a newer card.
    const permanent = PERMANENT_DECLINES.has(p.cancellation_details?.reason ?? "");
    const methodId = p.payment_method?.id;
    if (!methodId) return;
    await db
      .update(schema.subscription)
      .set({ status: "past_due", ...(permanent ? { yookassaPaymentMethodId: null } : {}), updatedAt: new Date() })
      .where(
        and(
          eq(schema.subscription.userId, row.userId),
          eq(schema.subscription.provider, "yookassa"),
          eq(schema.subscription.yookassaPaymentMethodId, methodId),
        ),
      );
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
  if (row) {
    await fetchAndApply(object.id);
    return 200;
  }

  // Unknown id: the server may have died between charging and saving the
  // payment. The payment read from the API (with our secret key) is
  // authoritative, so if its metadata says it's ours, record and apply it.
  // Refunds and anything else not created by this app are ignored.
  let payment: YkPayment;
  try {
    payment = await yk<YkPayment>(`/payments/${encodeURIComponent(object.id)}`);
  } catch {
    return 200;
  }
  const userId = payment.metadata?.userId;
  const kind = payment.metadata?.kind;
  if (!userId || (kind !== "initial" && kind !== "renewal" && kind !== "credits")) return 200;
  const credits = kind === "credits" ? Number.parseInt(payment.metadata?.credits ?? "", 10) : undefined;
  if (credits !== undefined && !(Number.isInteger(credits) && credits > 0 && credits <= 1_000_000)) return 200;
  const [user] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId));
  if (!user) return 200;
  await recordPayment(payment, userId, kind, credits);
  if (kind === "renewal") {
    await db
      .update(schema.renewalAttempt)
      .set({ paymentId: payment.id })
      .where(and(eq(schema.renewalAttempt.userId, userId), isNull(schema.renewalAttempt.paymentId)));
  }
  await applyPayment(payment);
  return 200;
}

/**
 * Back from the payment page: confirm the user's latest payment right away.
 * `credits` tells a pack of credits from a Pro payment.
 */
export async function syncLatestYooKassaPayment(
  userId: string,
): Promise<{ status: "succeeded" | "pending" | "failed"; credits?: number }> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.payment)
    .where(and(eq(schema.payment.userId, userId), inArray(schema.payment.kind, ["initial", "credits"])))
    .orderBy(desc(schema.payment.createdAt))
    .limit(1);
  if (!row) return { status: "failed" };
  const payment = await fetchAndApply(row.id);
  const credits = row.kind === "credits" ? (row.credits ?? undefined) : undefined;
  if (payment.status === "succeeded") return { status: "succeeded", credits };
  return { status: payment.status === "canceled" ? "failed" : "pending", credits };
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

type RenewalOutcome = "succeeded" | "failed" | "pending" | "skipped";

/**
 * Finds the renewal payment made for `userId` around `at` in YooKassa's
 * payment list. null = there is none; undefined = YooKassa couldn't be asked.
 */
async function findRenewalPayment(userId: string, at: Date): Promise<YkPayment | null | undefined> {
  const from = new Date(at.getTime() - 60 * 1000).toISOString();
  const to = new Date(at.getTime() + 15 * 60 * 1000).toISOString();
  try {
    const list = await yk<{ items: YkPayment[] }>(
      `/payments?created_at.gte=${encodeURIComponent(from)}&created_at.lte=${encodeURIComponent(to)}&limit=100`,
    );
    return list.items.find((p) => p.metadata?.userId === userId && p.metadata?.kind === "renewal") ?? null;
  } catch (err) {
    console.error("[yookassa] payment lookup failed", err);
    return undefined;
  }
}

/** Idempotence-Key of the renewal attempt for one period on one UTC day (YooKassa allows ≤ 64 chars). */
function renewalKey(userId: string, periodEnd: Date, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `renew-${createHash("sha256").update(`${userId}:${periodEnd.getTime()}:${day}`).digest("hex").slice(0, 40)}`;
}

/**
 * One renewal for one user. The attempt is written down before YooKassa is
 * called; if a previous attempt's outcome is unknown (the server died mid-
 * call) the same Idempotence-Key is reused, so YooKassa hands back the
 * original payment instead of charging the card again.
 */
async function renewOne(userId: string, now: Date): Promise<RenewalOutcome> {
  const db = await getDb();

  // Re-read the subscription right before charging: the user may have turned
  // auto-renew off or the period may have moved since the run started.
  const [row] = await db
    .select({ sub: schema.subscription, email: schema.user.email })
    .from(schema.subscription)
    .innerJoin(schema.user, eq(schema.user.id, schema.subscription.userId))
    .where(eq(schema.subscription.userId, userId));
  const sub = row?.sub;
  if (
    !sub ||
    sub.provider !== "yookassa" ||
    sub.cancelAtPeriodEnd ||
    !sub.yookassaPaymentMethodId ||
    sub.status === "canceled" ||
    sub.currentPeriodEnd.getTime() > now.getTime() + CHARGE_AHEAD_MS ||
    sub.currentPeriodEnd.getTime() <= now.getTime() - RETRY_WINDOW_MS
  ) {
    return "skipped";
  }

  const [last] = await db
    .select()
    .from(schema.renewalAttempt)
    .where(
      and(
        eq(schema.renewalAttempt.userId, userId),
        // Same period; a small window absorbs timestamp precision differences.
        gte(schema.renewalAttempt.periodEnd, new Date(sub.currentPeriodEnd.getTime() - 1000)),
        lte(schema.renewalAttempt.periodEnd, new Date(sub.currentPeriodEnd.getTime() + 1000)),
      ),
    )
    .orderBy(desc(schema.renewalAttempt.createdAt))
    .limit(1);

  // Overlapping runs (a repeated cron delivery, a manual run): leave it to the one already charging.
  if (last && !last.paymentId && now.getTime() - last.createdAt.getTime() < IN_FLIGHT_MS) return "skipped";

  let key: string;
  if (last && !last.paymentId && now.getTime() - last.createdAt.getTime() <= IDEMPOTENCE_TTL_MS) {
    // Outcome unknown, but YooKassa still remembers the key: resending it is
    // safe and returns the original payment if there was one.
    key = last.key;
  } else {
    if (last && !last.paymentId) {
      // Outcome unknown and the key has expired: look the payment up instead.
      const found = await findRenewalPayment(userId, last.createdAt);
      if (found === undefined) return "skipped"; // couldn't tell; try again next run
      if (found) {
        await recordPayment(found, userId, "renewal");
        await db.update(schema.renewalAttempt).set({ paymentId: found.id }).where(eq(schema.renewalAttempt.key, last.key));
        await applyPayment(found);
        return found.status === "succeeded" ? "succeeded" : found.status === "canceled" ? "failed" : "pending";
      }
      // No payment was ever created: safe to make a fresh attempt.
    }
    if (last?.paymentId) {
      const [payment] = await db.select().from(schema.payment).where(eq(schema.payment.id, last.paymentId));
      if (payment && (payment.status === "pending" || payment.status === "waiting_for_capture")) {
        // Still processing: ask YooKassa instead of waiting for a webhook that may never come.
        const fresh = await fetchAndApply(payment.id);
        return fresh.status === "succeeded" ? "succeeded" : fresh.status === "canceled" ? "failed" : "pending";
      }
      if (now.getTime() - last.createdAt.getTime() < RETRY_EVERY_MS) return "skipped";
    }
    // The key is the same for every run on the same day, so two overlapping
    // runs (a repeated cron delivery, a manual run) claim one attempt: only
    // the run whose insert lands goes on to charge.
    key = renewalKey(userId, sub.currentPeriodEnd, now);
    const [claimed] = await db
      .insert(schema.renewalAttempt)
      .values({ key, userId, periodEnd: sub.currentPeriodEnd })
      .onConflictDoNothing()
      .returning({ key: schema.renewalAttempt.key });
    if (!claimed) return "skipped";
  }

  const payment = await yk<YkPayment>("/payments", {
    method: "POST",
    idempotenceKey: key,
    body: {
      amount: amount(),
      capture: true,
      payment_method_id: sub.yookassaPaymentMethodId,
      description: DESCRIPTION,
      metadata: { userId, kind: "renewal" },
      ...receipt(row.email),
    },
  });
  await recordPayment(payment, userId, "renewal");
  await db.update(schema.renewalAttempt).set({ paymentId: payment.id }).where(eq(schema.renewalAttempt.key, key));
  await applyPayment(payment);
  return payment.status === "succeeded" ? "succeeded" : payment.status === "canceled" ? "failed" : "pending";
}

/**
 * Charges subscriptions that are about to end (or ended within the retry
 * window) from their saved payment method. Safe to run several times a day:
 * each subscription gets at most one new attempt per day.
 */
export async function chargeRenewals(now = new Date()): Promise<{ attempted: number; succeeded: number; failed: number; deferred: number }> {
  const started = Date.now();
  const db = await getDb();
  const due = await db
    .select({ userId: schema.subscription.userId })
    .from(schema.subscription)
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
    .orderBy(schema.subscription.currentPeriodEnd);

  const result = { attempted: 0, succeeded: 0, failed: 0, deferred: 0 };
  for (const { userId } of due) {
    // Leave the rest for the next run rather than being killed mid-charge.
    if (Date.now() - started > RUN_BUDGET_MS) {
      result.deferred++;
      continue;
    }
    try {
      const outcome = await renewOne(userId, now);
      if (outcome !== "skipped") result.attempted++;
      if (outcome === "succeeded") result.succeeded++;
      if (outcome === "failed") result.failed++;
    } catch (err) {
      result.failed++;
      console.error("[yookassa] renewal failed", userId, err);
    }
  }
  if (result.deferred) console.warn(`[yookassa] ${result.deferred} renewals deferred to the next run`);
  return result;
}
