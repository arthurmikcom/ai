import { handlePayPalWebhook, paypalConfigured } from "@/lib/server/billing/paypal";

/**
 * PayPal webhooks (CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED). Their
 * body isn't trusted: the order is read again from PayPal with our credentials.
 */
export async function POST(request: Request) {
  if (!paypalConfigured()) return new Response("PayPal не подключён", { status: 404 });
  const status = await handlePayPalWebhook(await request.json().catch(() => null));
  return new Response(status === 200 ? "ok" : "invalid", { status });
}
