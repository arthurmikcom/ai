import { handleStripeWebhook, stripeCreditsConfigured } from "@/lib/server/billing/stripe";

/** Stripe events. Authenticated by the stripe-signature header (STRIPE_WEBHOOK_SECRET). */
export async function POST(request: Request) {
  if (!stripeCreditsConfigured()) return new Response("Stripe не подключён", { status: 404 });
  const status = await handleStripeWebhook(await request.text(), request.headers.get("stripe-signature"));
  return new Response(status === 200 ? "ok" : "invalid", { status });
}
