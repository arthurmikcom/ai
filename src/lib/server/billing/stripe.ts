import Stripe from "stripe";
import { eq, or } from "drizzle-orm";
import type { SessionUser } from "../auth";
import { getDb, schema } from "../db";
import { grantCredits, type PackDef } from "./credits";
import { getSubscription, hasLiveStripe, isEntitled, isLiveStripe } from "./plans";

export function stripeConfigured(): boolean {
  const env = process.env;
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_PRO && env.STRIPE_WEBHOOK_SECRET);
}

/** Credit packs need no price in Stripe: each checkout names its own amount. */
export function stripeCreditsConfigured(): boolean {
  const env = process.env;
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
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
  if (hasLiveStripe(sub)) {
    throw new Error("У вас уже есть подписка Stripe — управляйте ею в настройках («Управлять подпиской»)");
  }
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

  // Our table can lag behind Stripe; ask Stripe too before opening a second subscription.
  const existing = await stripe().subscriptions.list({ customer: customerId, status: "all", limit: 20 });
  if (existing.data.some((s) => isLiveStripe(s.status))) {
    throw new Error("У вас уже есть подписка Stripe — управляйте ею в настройках («Управлять подпиской»)");
  }
  // Close checkout pages left open (another tab, an earlier attempt), so two of
  // them can't both be paid and create two subscriptions.
  const open = await stripe().checkout.sessions.list({ customer: customerId, status: "open", limit: 20 });
  await Promise.all(open.data.map((s) => stripe().checkout.sessions.expire(s.id)));

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

/** A one-off Checkout for a pack of credits (in US dollars); returns its URL. */
export async function startStripeCredits(user: SessionUser, origin: string, pack: PackDef): Promise<string> {
  const sub = await getSubscription(user.id);
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(pack.usd * 100),
          product_data: { name: `${pack.credits} кредитов MARYX Ai` },
        },
        quantity: 1,
      },
    ],
    ...(sub?.stripeCustomerId ? { customer: sub.stripeCustomerId } : { customer_email: user.email }),
    client_reference_id: user.id,
    metadata: { userId: user.id, kind: "credits", credits: String(pack.credits) },
    success_url: `${origin}/settings?billing=stripe-credits&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
  });
  if (!session.url) throw new Error("Stripe не вернул ссылку на оплату");
  return session.url;
}

/**
 * Adds the credits of a paid credits Checkout, once per session however often
 * Stripe (or the return page) reports it. Returns the session's state.
 */
async function applyCreditsSession(session: Stripe.Checkout.Session): Promise<"succeeded" | "pending" | "failed"> {
  if (session.mode !== "payment" || session.metadata?.kind !== "credits") return "failed";
  if (session.payment_status !== "paid") return session.status === "expired" ? "failed" : "pending";
  const userId = session.metadata.userId || session.client_reference_id;
  const credits = Number.parseInt(session.metadata.credits ?? "", 10);
  if (!userId || !Number.isInteger(credits) || credits <= 0) return "failed";
  try {
    await grantCredits({ id: `stripe:${session.id}`, userId, credits, source: "stripe" });
  } catch (err) {
    // The account may have been deleted in the meantime (foreign key).
    console.error("[stripe] failed to add credits", session.id, err);
    return "failed";
  }
  return "succeeded";
}

/** After the redirect back from a credits Checkout: add them without waiting for the webhook. */
export async function syncStripeCredits(userId: string, sessionId: string): Promise<"succeeded" | "pending" | "failed"> {
  if (!/^cs_\w{1,250}$/.test(sessionId)) return "failed";
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  // Only the buyer's own session: a session id from someone else adds nothing here.
  if ((session.metadata?.userId || session.client_reference_id) !== userId) return "failed";
  return applyCreditsSession(session);
}

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
  const isCurrent = existing?.stripeSubscriptionId === sub.id;
  if (!isCurrent && existing && isEntitled(existing)) {
    // Pro currently comes from something else. Only a promo period may be
    // replaced (checkout carried its remaining days over as a trial).
    const takesOverPromo = existing.provider === "promo" && (sub.status === "active" || sub.status === "trialing");
    if (!takesOverPromo) {
      // A second live subscription (e.g. paid in another tab) would bill the
      // user twice; stop it. Events about old, finished ones are ignored.
      if (isLiveStripe(sub.status)) {
        console.warn("[stripe] cancelling duplicate subscription", sub.id, "for", userId);
        await stripe().subscriptions.cancel(sub.id);
      }
      return;
    }
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
      } else if (session.mode === "payment") {
        await applyCreditsSession(session);
      }
      break;
    }
    // Bank transfers and the like are paid after the checkout completes.
    case "checkout.session.async_payment_succeeded":
      await applyCreditsSession(event.data.object);
      break;
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

/** Stops all Stripe billing for a user, e.g. before the account is deleted. */
export async function cancelStripeForUser(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  if (!sub?.stripeCustomerId) return;
  const list = await stripe().subscriptions.list({ customer: sub.stripeCustomerId, status: "all", limit: 100 });
  await Promise.all(list.data.filter((s) => isLiveStripe(s.status)).map((s) => stripe().subscriptions.cancel(s.id)));
}

/** After the redirect back from Checkout: apply the subscription without waiting for the webhook. */
export async function syncStripeForUser(userId: string): Promise<void> {
  const sub = await getSubscription(userId);
  if (!sub?.stripeCustomerId) return;
  // status "all": a cancelled subscription must be synced too (the default list hides it).
  const list = await stripe().subscriptions.list({ customer: sub.stripeCustomerId, status: "all", limit: 1 });
  const latest = list.data[0];
  if (latest) await syncSubscription(latest.id, userId);
}
