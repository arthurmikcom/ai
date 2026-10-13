import { siteOrigin } from "@/lib/server/billing/origin";
import { startStripeCheckout, stripeConfigured } from "@/lib/server/billing/stripe";
import { startYooKassaCheckout, yookassaConfigured } from "@/lib/server/billing/yookassa";
import { describeError } from "@/lib/server/errors";
import { jsonError, requireUser } from "@/lib/server/http";

/** Starts a Pro purchase: { method: "yookassa" | "stripe", consent: true } → { url } of the payment page. */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { method?: unknown; consent?: unknown } | null;
  // Auto-renewal needs the user's explicit consent (376-ФЗ).
  if (body?.consent !== true) return jsonError("Подтвердите согласие с автопродлением подписки", 400);

  try {
    const origin = siteOrigin(request);
    if (body.method === "yookassa" && yookassaConfigured()) {
      return Response.json({ url: await startYooKassaCheckout(user, origin) });
    }
    if (body.method === "stripe" && stripeConfigured()) {
      return Response.json({ url: await startStripeCheckout(user, origin) });
    }
    return jsonError("Этот способ оплаты не подключён", 400);
  } catch (err) {
    console.error("[billing] checkout failed", err);
    return jsonError(describeError(err), 502);
  }
}
