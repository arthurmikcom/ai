import { creditsFor, MIN_CREDITS } from "@/lib/server/billing/credits";
import { sellablePacks } from "@/lib/server/billing/packs";
import { FEATURED_MODELS } from "@/lib/catalog";
import { mediaCost } from "@/lib/server/pricing";
import { planDailyUsd } from "@/lib/server/spend";
import { planLimit } from "@/lib/server/billing/plans";
import { stripeConfigured, stripeCreditsConfigured, stripePriceLabel } from "@/lib/server/billing/stripe";
import { yookassaConfigured, yookassaPriceLabel } from "@/lib/server/billing/yookassa";
import { requireUser } from "@/lib/server/http";
import { USAGE_KINDS, type BillingOptions, type PlanId, type UsageKind } from "@/lib/types";

function cheapest(kind: "image" | "video"): number {
  const prices = FEATURED_MODELS.filter((m) => m.capability === kind).map((m) => creditsFor(kind, mediaCost(kind, m.id)));
  return prices.length ? Math.min(...prices) : MIN_CREDITS[kind];
}

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
      ? sellablePacks().map((p) => ({
          id: p.id,
          credits: p.credits,
          ...(rub && p.rub > 0 ? { rub: money(p.rub, "RUB") } : {}),
          ...(usd && p.usd > 0 ? { usd: money(p.usd, "USD") } : {}),
        }))
        .filter((p) => p.rub || p.usd)
      : [];

  const body: BillingOptions = {
    limits: { free: limits("free"), pro: limits("pro") },
    budget: { free: planDailyUsd("free"), pro: planDailyUsd("pro") },
    // "From N credits": the cheapest picture and clip among the models on offer, at their default size.
    credits: {
      packs,
      min: {
        ...MIN_CREDITS,
        image: cheapest("image"),
        video: cheapest("video"),
      },
    },
    methods: {
      yookassa: yookassaConfigured() ? { price: yookassaPriceLabel() } : null,
      stripe,
    },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
