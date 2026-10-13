import Stripe from "stripe";
import { eq, or } from "drizzle-orm";
import type { SessionUser } from "../auth";
import { getDb, schema } from "../db";
import { getSubscription, isEntitled } from "./plans";

export function stripeConfigured(): boolean {
  const env = process.env;
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_PRO && env.STRIPE_WEBHOOK_SECRET);
}

let client: Stripe | null = null;

/** Created lazily: building the client at import time breaks `next build` without keys. */
function stripe(): Stripe {
  if (!client) {
    // STRIPE_API_URL points the SDK at a local mock (e.g. stripe-mock) for testing.
    const mock = process.env.STRIPE_API_URL ? new URL(process.env.STRIPE_API_URL) : null;
    client = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
      apiVersion: "2026-09-30.endive",
      ...(mock
        ? {
            host: mock.hostname,
            port: Number(mock.port) || undefined,
            protocol: mock.protocol.replace(":", "") as "http" | "https",
          }
        : {}),
    });
  }
  return client;
}

let priceCache: { at: number; label: string } | null = null;

/** "12,00 $" — the Pro price as configured in Stripe (cached for 10 minutes). */
export async function stripePriceLabel(): Promise<string> {
  if (priceCache && Date.now() - priceCache.at < 10 * 60 * 1000) return priceCache.label;
  const price = await stripe().prices.retrieve(process.env.STRIPE_PRICE_PRO!);
  const amount = (price.unit_amount ?? 0) / 100;
  const label = new Intl.NumberFormat("ru-RU", { style: "currency", currency: price.currency.toUpperCase() }).format(amount);
  priceCache = { at: Date.now(), label };
  return label;
}

/** Starts a Stripe Checkout for the Pro subscription and returns its URL. */
export async function startStripeCheckout(user: SessionUser, origin: string): Promise<string> {
  const sub = await getSubscription(user.id);
  const promo = isEntitled(sub) && sub?.provider === "promo";
  if (isEntitled(sub) && !promo) throw new Error("У вас уже есть Pro");
  // Promo days aren't lost: billing starts when they end (Stripe needs ≥ 48 h).
  const trialEnd =
    promo && sub && sub.currentPeriodEnd.getTime() > Date.now() + 49 * 60 * 60 * 1000
      ? Math.floor(sub.currentPeriodEnd.getTime() / 1000)
      : undefined;

  let customerId = sub?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe().customers.create(
      { email: user.email, name: user.name || undefined, metadata: { userId: user.id } },
      { idempotencyKey: `customer-${user.id}` },
    );
    customerId = customer.id;
    const db = await getDb();
    await db
      .insert(schema.subscription)
      .values({
        userId: user.id,
        plan: "pro",
        provider: "stripe",
        status: "incomplete",
        currentPeriodEnd: new Date(0),
        stripeCustomerId: customerId,
      })
      .onConflictDoUpdate({ target: schema.subscription.userId, set: { stripeCustomerId: customerId } });
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_PRO!, quantity: 1 }],
    customer: customerId,
    client_reference_id: user.id,
    metadata: { userId: user.id },
    subscription_data: { metadata: { userId: user.id }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    allow_promotion_codes: true,
    success_url: `${origin}/settings?billing=stripe`,
    cancel_url: `${origin}/pricing`,
  });
  if (!session.url) throw new Error("Stripe не вернул ссылку на оплату");
  return session.url;
}

/** Stripe's customer portal: change card, see invoices, cancel. */
export async function stripePortalUrl(userId: string, origin: string): Promise<string> {
  const sub = await getSubscription(userId);
  if (!sub?.stripeCustomerId) throw new Error("Подписка Stripe не найдена");
  const portal = await stripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${origin}/settings`,
  });
  return portal.url;
}

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;

/**
 * Copies the current state of a Stripe subscription into our table. Always
 * re-reads the subscription from Stripe, so out-of-order or replayed webhook
 * events can't leave stale data behind.
 */
async function syncSubscription(subscriptionId: string, userIdHint?: string | null): Promise<void> {
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const customerId = idOf(sub.customer);
  const db = await getDb();

  let userId = sub.metadata.userId || userIdHint || undefined;
  if (!userId) {
    const [row] = await db
      .select({ userId: schema.subscription.userId })
      .from(schema.subscription)
      .where(
        or(
          eq(schema.subscription.stripeSubscriptionId, sub.id),
          customerId ? eq(schema.subscription.stripeCustomerId, customerId) : undefined,
        ),
      );
    userId = row?.userId;
  }
  if (!userId) {
    console.warn("[stripe] subscription without a known user", sub.id);
    return;
  }

  const existing = await getSubscription(userId);
  // Don't let events about an old Stripe subscription override a running
  // YooKassa subscription. (A promo period may be replaced: checkout carries
  // its remaining days over as a trial.)
  if (existing?.provider === "yookassa" && isEntitled(existing) && existing.stripeSubscriptionId !== sub.id) {
    return;
  }

  const periodEnd = sub.items.data[0]?.current_period_end;
  const values = {
    plan: "pro" as const,
    provider: "stripe" as const,
    status: sub.status,
    currentPeriodEnd: new Date((periodEnd ?? 0) * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end || sub.cancel_at !== null,
    stripeCustomerId: customerId ?? null,
    stripeSubscriptionId: sub.id,
    updatedAt: new Date(),
  };
  try {
    await db
      .insert(schema.subscription)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: schema.subscription.userId, set: values });
  } catch (err) {
    // The account may have been deleted in the meantime (foreign key).
    console.error("[stripe] failed to save subscription", sub.id, err);
  }
}

/** Verifies and applies a Stripe webhook. Returns an HTTP status. */
export async function handleStripeWebhook(body: string, signature: string | null): Promise<number> {
  if (!signature) return 400;
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    if (err instanceof Stripe.errors.StripeSignatureVerificationError) return 400;
    throw err;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const subscriptionId = idOf(session.subscription);
      if (session.mode === "subscription" && subscriptionId) {
        await syncSubscription(subscriptionId, session.client_reference_id);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object.id);
      break;
    case "invoice.paid":
    case "invoice.payment_failed": {
      const subscriptionId = idOf(event.data.object.parent?.subscription_details?.subscription);
      if (subscriptionId) await syncSubscription(subscriptionId);
      break;
    }
  }
  return 200;
}

/** Stops Stripe billing, e.g. before the account is deleted. */
export async function cancelStripeForUser(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  if (sub?.provider !== "stripe" || !sub.stripeSubscriptionId || sub.status === "canceled") return;
  await stripe().subscriptions.cancel(sub.stripeSubscriptionId);
}

/** After the redirect back from Checkout: apply the subscription without waiting for the webhook. */
export async function syncStripeForUser(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  if (!sub?.stripeCustomerId) return;
  const list = await stripe().subscriptions.list({ customer: sub.stripeCustomerId, limit: 1 });
  const latest = list.data[0];
  if (latest) await syncSubscription(latest.id, userId);
}
