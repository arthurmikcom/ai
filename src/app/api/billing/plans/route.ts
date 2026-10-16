import { creditPacks, MIN_CREDITS } from "@/lib/server/billing/credits";
import { planLimit } from "@/lib/server/billing/plans";
import { stripeConfigured, stripeCreditsConfigured, stripePriceLabel } from "@/lib/server/billing/stripe";
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

  // Packs are on sale with whichever payment methods are set up.
  const rub = yookassaConfigured();
  const usd = stripeCreditsConfigured();
  const money = (value: number, currency: string) =>
    new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: currency === "RUB" ? 0 : 2 }).format(value);
  const packs =
    rub || usd
      ? creditPacks().map((p) => ({
          id: p.id,
          credits: p.credits,
          ...(rub ? { rub: money(p.rub, "RUB") } : {}),
          ...(usd ? { usd: money(p.usd, "USD") } : {}),
        }))
      : [];

  const body: BillingOptions = {
    limits: { free: limits("free"), pro: limits("pro") },
    credits: { packs, min: MIN_CREDITS },
    methods: {
      yookassa: yookassaConfigured() ? { price: yookassaPriceLabel() } : null,
      stripe,
    },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
