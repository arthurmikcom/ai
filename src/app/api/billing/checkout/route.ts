import { isPaidPlan, PLAN_NAMES } from "@/lib/plans";
import { siteOrigin } from "@/lib/server/billing/origin";
import { getSubscription, hasLiveStripe } from "@/lib/server/billing/plans";
import { changeStripePlan, startStripeCheckout, stripeConfigured, stripeSells } from "@/lib/server/billing/stripe";
import { startYooKassaCheckout, yookassaConfigured } from "@/lib/server/billing/yookassa";
import { describeError } from "@/lib/server/errors";
import { jsonError, requireUser } from "@/lib/server/http";

/**
 * Starts a plan's purchase: { method: "yookassa" | "stripe", plan: "plus" | "pro" | "ultra", consent: true }
 * → { url } of the payment page. A live Stripe subscription switches plan instead → { changed: plan }.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { method?: unknown; plan?: unknown; consent?: unknown } | null;
  // Auto-renewal needs the user's explicit consent (376-ФЗ).
  if (body?.consent !== true) return jsonError("Подтвердите согласие с автопродлением подписки", 400);
  const plan = body.plan === undefined ? "pro" : body.plan;
  if (!isPaidPlan(plan)) return jsonError("Нет такого тарифа", 400);

  try {
    const origin = siteOrigin(request);
    if (body.method === "yookassa" && yookassaConfigured()) {
      if (plan !== "pro") return jsonError(`${PLAN_NAMES[plan]} оплачивается картой (Stripe); в рублях — только Pro`, 400);
      return Response.json({ url: await startYooKassaCheckout(user, origin) });
    }
    if (body.method === "stripe" && stripeConfigured()) {
      if (!stripeSells(plan)) return jsonError(`${PLAN_NAMES[plan]} сейчас не продаётся`, 400);
      // Already subscribed with Stripe: the same subscription moves to the other plan.
      if (hasLiveStripe(await getSubscription(user.id))) {
        await changeStripePlan(user.id, plan);
        return Response.json({ changed: plan });
      }
      return Response.json({ url: await startStripeCheckout(user, origin, plan) });
    }
    return jsonError("Этот способ оплаты не подключён", 400);
  } catch (err) {
    console.error("[billing] checkout failed", err);
    return jsonError(describeError(err), 502);
  }
}
