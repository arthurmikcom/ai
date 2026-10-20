import { isPaidPlan, PLAN_NAMES } from "@/lib/plans";
import { siteOrigin } from "@/lib/server/billing/origin";
import { changePaddlePlan, paddleSells, startPaddleCheckout } from "@/lib/server/billing/paddle";
import { paypalConfigured, startPayPal } from "@/lib/server/billing/paypal";
import { getSubscription, hasLivePaddle, hasLiveStripe } from "@/lib/server/billing/plans";
import { changeStripePlan, startStripeCheckout, stripeConfigured, stripeSells } from "@/lib/server/billing/stripe";
import { startTon, tonConfigured } from "@/lib/server/billing/ton";
import { startYooKassaCheckout, yookassaConfigured } from "@/lib/server/billing/yookassa";
import { describeError } from "@/lib/server/errors";
import { jsonError, requireUser } from "@/lib/server/http";

/**
 * Starts a plan's purchase: { method, plan: "plus" | "pro" | "ultra", consent } → { url } of the payment page.
 * Subscriptions (method "stripe" | "paddle" | "yookassa") need the consent to auto-renewal; a live Stripe or
 * Paddle subscription switches plan instead → { changed: plan }. "paypal" and "ton" pay for one month.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { method?: unknown; plan?: unknown; consent?: unknown } | null;
  const method = body?.method;
  // Auto-renewal needs the user's explicit consent (376-ФЗ); a month paid once renews nothing.
  if (method !== "paypal" && method !== "ton" && body?.consent !== true) return jsonError("Подтвердите согласие с автопродлением подписки", 400);
  const plan = body?.plan === undefined ? "pro" : body.plan;
  if (!isPaidPlan(plan)) return jsonError("Нет такого тарифа", 400);

  try {
    const origin = siteOrigin(request);
    if (method === "yookassa" && yookassaConfigured()) {
      if (plan !== "pro") return jsonError(`${PLAN_NAMES[plan]} оплачивается картой; в рублях — только Pro`, 400);
      return Response.json({ url: await startYooKassaCheckout(user, origin) });
    }
    if (method === "stripe" && stripeConfigured()) {
      if (!stripeSells(plan)) return jsonError(`${PLAN_NAMES[plan]} сейчас не продаётся`, 400);
      // Already subscribed with Stripe: the same subscription moves to the other plan.
      if (hasLiveStripe(await getSubscription(user.id))) {
        await changeStripePlan(user.id, plan);
        return Response.json({ changed: plan });
      }
      return Response.json({ url: await startStripeCheckout(user, origin, plan) });
    }
    if (method === "paddle" && paddleSells(plan)) {
      if (hasLivePaddle(await getSubscription(user.id))) {
        await changePaddlePlan(user.id, plan);
        return Response.json({ changed: plan });
      }
      return Response.json({ url: await startPaddleCheckout(user, origin, plan) });
    }
    if (method === "paypal" && paypalConfigured()) return Response.json({ url: await startPayPal(user, origin, { plan }) });
    if (method === "ton" && tonConfigured()) return Response.json({ url: `${origin}/pay/ton?id=${await startTon(user, { plan })}` });
    return jsonError("Этот способ оплаты не подключён", 400);
  } catch (err) {
    console.error("[billing] checkout failed", err);
    return jsonError(describeError(err), 502);
  }
}
