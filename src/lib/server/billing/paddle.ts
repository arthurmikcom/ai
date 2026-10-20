// Paddle Billing: Paddle sells as the merchant of record (it handles VAT and
// sales tax) and renews subscriptions itself, like Stripe. A purchase starts
// as a Paddle transaction made on our server; the site's /pay/paddle page
// opens Paddle's checkout for it. State comes from signed webhooks, and every
// event is confirmed by re-reading the subscription or transaction from Paddle.

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, or } from "drizzle-orm";
import type { SessionUser } from "../auth";
import { getDb, schema } from "../db";
import { HttpError } from "../errors";
import { isPaidPlan, PAID_PLANS, PLAN_NAMES } from "@/lib/plans";
import type { PaidPlanId } from "@/lib/types";
import { grantCredits, type PackDef } from "./credits";
import { getSubscription, hasLivePaddle, hasLiveStripe, isEntitled, isLivePaddle, isOneOff, planEnv, renewingBlock, subscriptionPlan } from "./plans";

const env = (name: string) => process.env[name]?.trim() || undefined;

/** A plan's price in Paddle's catalog (PADDLE_PRICE_PLUS, …: pri_…); a plan without one isn't sold through Paddle. */
function paddlePriceId(plan: PaidPlanId): string | undefined {
  return env(`PADDLE_PRICE_${planEnv(plan)}`);
}

export function paddleSells(plan: PaidPlanId): boolean {
  return Boolean(paddleCreditsConfigured() && paddlePriceId(plan));
}

/** Keys, the webhook's secret and the checkout's client token: enough to sell credit packs. */
export function paddleCreditsConfigured(): boolean {
  return Boolean(env("PADDLE_API_KEY") && env("PADDLE_WEBHOOK_SECRET") && env("PADDLE_CLIENT_TOKEN"));
}

/** Paddle takes subscriptions: set up, with at least one plan's price. */
export function paddleConfigured(): boolean {
  return PAID_PLANS.some(paddleSells);
}

/** Sandbox keys (pdl_sdbx_…, client token test_…) or PADDLE_ENV=sandbox. */
export function paddleSandbox(): boolean {
  return env("PADDLE_ENV") === "sandbox" || Boolean(env("PADDLE_API_KEY")?.includes("_sdbx_"));
}

function base(): string {
  return (env("PADDLE_API_URL") ?? (paddleSandbox() ? "https://sandbox-api.paddle.com" : "https://api.paddle.com")).replace(/\/+$/, "");
}

interface PaddleError {
  error?: { code?: string; detail?: string };
}

async function pd<T>(path: string, init?: { method: "POST" | "PATCH"; body: unknown }): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${env("PADDLE_API_KEY")}`, "Content-Type": "application/json" },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as PaddleError | null;
    throw Object.assign(new HttpError(res.status, `Paddle: ${err?.error?.detail ?? res.statusText}`), { code: err?.error?.code });
  }
  return ((await res.json()) as { data: T }).data;
}

/** What the checkout page needs: the client token (public by design), sandbox or live, Paddle.js. */
export function paddleClientConfig(): { token: string; sandbox: boolean; script: string } | null {
  const token = env("PADDLE_CLIENT_TOKEN");
  if (!token || !paddleCreditsConfigured()) return null;
  return { token, sandbox: paddleSandbox(), script: env("PADDLE_JS_URL") ?? "https://cdn.paddle.com/paddle/v2/paddle.js" };
}

const priceCache = new Map<PaidPlanId, { at: number; price: { amount: number; currency: string } }>();

/** A plan's price in Paddle's catalog (cached for 10 minutes). */
export async function paddlePlanPrice(plan: PaidPlanId): Promise<{ amount: number; currency: string }> {
  const cached = priceCache.get(plan);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.price;
  const raw = await pd<{ unit_price: { amount: string; currency_code: string } }>(`/prices/${encodeURIComponent(paddlePriceId(plan) ?? "")}`);
  const currency = raw.unit_price.currency_code.toUpperCase();
  // Amounts come in the smallest unit; JPY and KRW have none smaller.
  const amount = Number(raw.unit_price.amount) / (currency === "JPY" || currency === "KRW" ? 1 : 100);
  const price = { amount, currency };
  priceCache.set(plan, { at: Date.now(), price });
  return price;
}

export async function paddlePriceLabel(plan: PaidPlanId): Promise<string> {
  const { amount, currency } = await paddlePlanPrice(plan);
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(amount);
}

/** The user's Paddle customer: saved, or created (or found, if Paddle already knows the email). */
async function paddleCustomer(user: SessionUser): Promise<string> {
  const sub = await getSubscription(user.id);
  if (sub?.paddleCustomerId) return sub.paddleCustomerId;
  let id: string;
  try {
    id = (await pd<{ id: string }>("/customers", { method: "POST", body: { email: user.email, name: user.name || undefined, custom_data: { userId: user.id } } })).id;
  } catch (err) {
    // "customer email conflicts with customer of id ctm_…"
    const known = (err as { code?: string }).code === "customer_already_exists" && /ctm_\w+/.exec((err as Error).message)?.[0];
    if (!known) throw err;
    id = known;
  }
  const db = await getDb();
  if (sub) await db.update(schema.subscription).set({ paddleCustomerId: id }).where(eq(schema.subscription.userId, user.id));
  else {
    await db
      .insert(schema.subscription)
      .values({ userId: user.id, plan: "pro", provider: "paddle", status: "incomplete", currentPeriodEnd: new Date(0), paddleCustomerId: id })
      .onConflictDoUpdate({ target: schema.subscription.userId, set: { paddleCustomerId: id } });
  }
  return id;
}

/** The user's Paddle customer id, for Paddle Retain on the checkout page (none yet: undefined). */
export async function paddleCustomerId(userId: string): Promise<string | undefined> {
  return (await getSubscription(userId))?.paddleCustomerId ?? undefined;
}

/** The checkout page for a transaction: the site's own, which opens Paddle's checkout. */
function checkoutPage(origin: string, transactionId: string): string {
  return `${origin}/pay/paddle?txn=${encodeURIComponent(transactionId)}`;
}

/** Starts a subscription to a plan: a Paddle transaction, and the page that pays it. */
export async function startPaddleCheckout(user: SessionUser, origin: string, plan: PaidPlanId): Promise<string> {
  const priceId = paddlePriceId(plan);
  if (!priceId) throw new Error(`${PLAN_NAMES[plan]} сейчас не продаётся через Paddle`);
  const sub = await getSubscription(user.id);
  const blocked = renewingBlock(sub);
  if (blocked) throw new Error(blocked);
  // A month paid through PayPal or TON runs to its end first (a promo period may be replaced).
  if (sub && isEntitled(sub) && sub.provider !== "promo") {
    throw new Error(
      `У вас ${PLAN_NAMES[subscriptionPlan(sub)]} до ${sub.currentPeriodEnd.toLocaleDateString("ru-RU")}. Подписку можно оформить после этой даты, а продлить месяц — так же, как вы его оплатили.`,
    );
  }
  const customer = await paddleCustomer(user);
  const txn = await pd<{ id: string }>("/transactions", {
    method: "POST",
    body: { items: [{ price_id: priceId, quantity: 1 }], customer_id: customer, custom_data: { userId: user.id, plan, kind: "plan" } },
  });
  return checkoutPage(origin, txn.id);
}

/** A pack of credits, priced right in the transaction (nothing to set up in Paddle's catalog). */
export async function startPaddleCredits(user: SessionUser, origin: string, pack: PackDef): Promise<string> {
  if (!(pack.usd > 0)) throw new Error("Этот пакет не продаётся в долларах");
  const customer = await paddleCustomer(user);
  const name = `${pack.credits} кредитов MARYX Ai`;
  const product = env("PADDLE_CREDITS_PRODUCT");
  const txn = await pd<{ id: string }>("/transactions", {
    method: "POST",
    body: {
      items: [
        {
          quantity: 1,
          price: {
            description: name,
            name,
            unit_price: { amount: String(Math.round(pack.usd * 100)), currency_code: "USD" },
            ...(product ? { product_id: product } : { product: { name: "MARYX Ai — кредиты", tax_category: env("PADDLE_TAX_CATEGORY") ?? "standard" } }),
          },
        },
      ],
      customer_id: customer,
      custom_data: { userId: user.id, kind: "credits", credits: String(pack.credits) },
    },
  });
  return checkoutPage(origin, txn.id);
}

interface PaddleSubscription {
  id: string;
  status: string;
  customer_id: string;
  custom_data?: { userId?: string; plan?: string } | null;
  items: { price: { id: string } }[];
  current_billing_period?: { starts_at: string; ends_at: string } | null;
  scheduled_change?: { action: "cancel" | "pause" | "resume"; effective_at: string } | null;
  canceled_at?: string | null;
}

/** Which plan a Paddle subscription is for: its custom data, else its price, else Pro. */
function paddleSubscriptionPlan(sub: PaddleSubscription): PaidPlanId {
  if (isPaidPlan(sub.custom_data?.plan)) return sub.custom_data.plan;
  const price = sub.items[0]?.price.id;
  return PAID_PLANS.find((p) => price && paddlePriceId(p) === price) ?? "pro";
}

/**
 * Copies a Paddle subscription's current state into our table, always
 * re-reading it from Paddle, so out-of-order or replayed events can't leave
 * stale data behind.
 */
async function syncPaddleSubscription(id: string, userIdHint?: string): Promise<void> {
  const sub = await pd<PaddleSubscription>(`/subscriptions/${encodeURIComponent(id)}`);
  const db = await getDb();
  let userId = sub.custom_data?.userId || userIdHint;
  if (!userId) {
    const [row] = await db
      .select({ userId: schema.subscription.userId })
      .from(schema.subscription)
      .where(or(eq(schema.subscription.paddleSubscriptionId, sub.id), eq(schema.subscription.paddleCustomerId, sub.customer_id)));
    userId = row?.userId;
  }
  if (!userId) {
    console.warn("[paddle] subscription without a known user", sub.id);
    return;
  }

  const existing = await getSubscription(userId);
  const isCurrent = existing?.paddleSubscriptionId === sub.id;
  if (!isCurrent && existing && isEntitled(existing)) {
    // A promo period or a month paid once is replaced by the subscription;
    // a second subscription that bills by itself is stopped instead.
    const takesOver = (existing.provider === "promo" || isOneOff(existing.provider)) && (sub.status === "active" || sub.status === "trialing");
    if (!takesOver || hasLiveStripe(existing) || hasLivePaddle(existing)) {
      if (isLivePaddle(sub.status)) {
        console.warn("[paddle] cancelling duplicate subscription", sub.id, "for", userId);
        await pd(`/subscriptions/${encodeURIComponent(sub.id)}/cancel`, { method: "POST", body: { effective_from: "immediately" } });
      }
      return;
    }
  }

  const values = {
    plan: paddleSubscriptionPlan(sub),
    provider: "paddle" as const,
    status: sub.status,
    // A cancelled subscription has no billing period left.
    currentPeriodEnd: new Date(sub.current_billing_period?.ends_at ?? sub.canceled_at ?? Date.now()),
    cancelAtPeriodEnd: sub.scheduled_change?.action === "cancel",
    paddleCustomerId: sub.customer_id,
    paddleSubscriptionId: sub.id,
    updatedAt: new Date(),
  };
  try {
    await db.insert(schema.subscription).values({ userId, ...values }).onConflictDoUpdate({ target: schema.subscription.userId, set: values });
  } catch (err) {
    // The account may have been deleted in the meantime (foreign key).
    console.error("[paddle] failed to save subscription", sub.id, err);
  }
}

interface PaddleTransaction {
  id: string;
  status: "draft" | "ready" | "billed" | "paid" | "completed" | "canceled" | "past_due";
  customer_id?: string | null;
  subscription_id?: string | null;
  custom_data?: { userId?: string; kind?: string; credits?: string; plan?: string } | null;
}

/** Applies a paid transaction: a pack's credits (once), or the subscription it started. */
async function applyTransaction(txn: PaddleTransaction): Promise<"succeeded" | "pending" | "failed"> {
  if (txn.status === "canceled") return "failed";
  if (txn.status !== "paid" && txn.status !== "completed") return "pending";
  const userId = txn.custom_data?.userId;
  if (txn.subscription_id) {
    await syncPaddleSubscription(txn.subscription_id, userId);
    return "succeeded";
  }
  const credits = Number.parseInt(txn.custom_data?.credits ?? "", 10);
  if (txn.custom_data?.kind !== "credits" || !userId || !Number.isInteger(credits) || credits <= 0) return "failed";
  try {
    await grantCredits({ id: `paddle:${txn.id}`, userId, credits, source: "paddle" });
  } catch (err) {
    // Only a deleted account (foreign key) is final; anything else fails loudly so Paddle retries.
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) !== "23503") throw err;
    console.error("[paddle] account gone, credits not added", txn.id);
    return "failed";
  }
  return "succeeded";
}

/** Back from the checkout page: the user's own transaction, applied without waiting for the webhook. */
export async function syncPaddle(userId: string, transactionId: string): Promise<{ status: "succeeded" | "pending" | "failed"; credits: boolean }> {
  if (!/^txn_\w{10,60}$/.test(transactionId)) return { status: "failed", credits: false };
  const txn = await pd<PaddleTransaction>(`/transactions/${encodeURIComponent(transactionId)}`);
  const credits = txn.custom_data?.kind === "credits";
  // Only the buyer's own transaction: someone else's id adds nothing here.
  if (txn.custom_data?.userId !== userId) return { status: "failed", credits };
  try {
    return { status: await applyTransaction(txn), credits };
  } catch (err) {
    // Paid, but not applied yet: the webhook will retry. Never tell a paying user it failed.
    console.error("[paddle] sync failed", txn.id, err);
    return { status: "pending", credits };
  }
}

/**
 * Moves a live Paddle subscription to another plan now; Paddle charges or
 * credits the difference for the rest of the period right away.
 */
export async function changePaddlePlan(userId: string, plan: PaidPlanId): Promise<void> {
  const sub = await getSubscription(userId);
  if (!sub?.paddleSubscriptionId || !hasLivePaddle(sub)) throw new Error("Подписка Paddle не найдена");
  if (subscriptionPlan(sub) === plan && isEntitled(sub)) throw new Error(`У вас уже ${PLAN_NAMES[plan]}`);
  const priceId = paddlePriceId(plan);
  if (!priceId) throw new Error(`${PLAN_NAMES[plan]} сейчас не продаётся через Paddle`);
  await pd(`/subscriptions/${encodeURIComponent(sub.paddleSubscriptionId)}`, {
    method: "PATCH",
    body: {
      items: [{ price_id: priceId, quantity: 1 }],
      proration_billing_mode: "prorated_immediately",
      custom_data: { userId, plan },
      // A plan switched back from «cancel at period end» renews again.
      scheduled_change: null,
    },
  });
  await syncPaddleSubscription(sub.paddleSubscriptionId, userId);
}

/** Paddle's customer portal: card, invoices, cancellation. */
export async function paddlePortalUrl(userId: string): Promise<string> {
  const sub = await getSubscription(userId);
  if (!sub?.paddleCustomerId) throw new Error("Подписка Paddle не найдена");
  const session = await pd<{ urls: { general: { overview: string } } }>(`/customers/${encodeURIComponent(sub.paddleCustomerId)}/portal-sessions`, {
    method: "POST",
    body: sub.paddleSubscriptionId ? { subscription_ids: [sub.paddleSubscriptionId] } : {},
  });
  return session.urls.general.overview;
}

/** Stops a user's Paddle subscription at once, e.g. before the account is deleted. */
export async function cancelPaddleForUser(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  if (!sub?.paddleSubscriptionId || !hasLivePaddle(sub)) return;
  await pd(`/subscriptions/${encodeURIComponent(sub.paddleSubscriptionId)}/cancel`, { method: "POST", body: { effective_from: "immediately" } });
}

/**
 * Checks the Paddle-Signature header ("ts=…;h1=…"): an HMAC-SHA256 of
 * "<ts>:<raw body>" with the notification destination's secret, sent at most
 * five minutes ago (a replayed old delivery is refused).
 */
export function verifyPaddleSignature(body: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(";").map((p) => p.split("=") as [string, string]);
  const ts = parts.find(([k]) => k === "ts")?.[1];
  const signatures = parts.filter(([k]) => k === "h1").map(([, v]) => v);
  if (!ts || !/^\d+$/.test(ts) || !signatures.length || Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${ts}:${body}`).digest();
  return signatures.some((s) => {
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Verifies and applies a Paddle webhook. Returns an HTTP status. */
export async function handlePaddleWebhook(body: string, signature: string | null): Promise<number> {
  if (!verifyPaddleSignature(body, signature, env("PADDLE_WEBHOOK_SECRET") ?? "")) return 400;
  let event: { event_type?: string; data?: { id?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return 400;
  }
  const id = event.data?.id;
  if (typeof id !== "string") return 200;
  if (event.event_type?.startsWith("subscription.")) {
    await syncPaddleSubscription(id);
  } else if (event.event_type === "transaction.completed" || event.event_type === "transaction.paid") {
    await applyTransaction(await pd<PaddleTransaction>(`/transactions/${encodeURIComponent(id)}`));
  }
  return 200;
}
