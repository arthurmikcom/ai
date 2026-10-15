import { planLimit } from "@/lib/server/billing/plans";
import { stripeConfigured, stripePriceLabel } from "@/lib/server/billing/stripe";
import { yookassaConfigured, yookassaPriceLabel } from "@/lib/server/billing/yookassa";
import { requireUser } from "@/lib/server/http";
import { USAGE_KINDS, type BillingOptions, type PlanId, type UsageKind } from "@/lib/types";

/** Plans, their limits and the payment methods this server accepts. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const limits = (plan: PlanId) =>
    Object.fromEntries(USAGE_KINDS.map((k) => [k, planLimit(plan, k)])) as Record<UsageKind, number | null>;

  let stripe: BillingOptions["methods"]["stripe"] = null;
  if (stripeConfigured()) {
    try {
      stripe = { price: await stripePriceLabel() };
    } catch (err) {
      console.error("[billing] Stripe price unavailable", err);
    }
  }

  const body: BillingOptions = {
    limits: { free: limits("free"), pro: limits("pro") },
    methods: {
      yookassa: yookassaConfigured() ? { price: yookassaPriceLabel() } : null,
      stripe,
    },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
