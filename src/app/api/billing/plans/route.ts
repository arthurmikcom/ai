import { creditsFor, MIN_CREDITS } from "@/lib/server/billing/credits";
import { sellablePacks } from "@/lib/server/billing/packs";
import { listModels } from "@/lib/server/models";
import { mediaCost } from "@/lib/server/pricing";
import { planDailyUsd } from "@/lib/server/spend";
import { planLimit } from "@/lib/server/billing/plans";
import { stripeConfigured, stripeCreditsConfigured, stripePriceLabel } from "@/lib/server/billing/stripe";
import { yookassaConfigured, yookassaPriceLabel } from "@/lib/server/billing/yookassa";
import { requireUser } from "@/lib/server/http";
import { USAGE_KINDS, type BillingOptions, type PlanId, type UsageKind } from "@/lib/types";

/** The cheapest picture or clip among the models this site offers, at their default size. */
async function cheapest(kind: "image" | "video"): Promise<number> {
  const { models } = await listModels(kind).catch(() => ({ models: [] }));
  const prices = models.map((m) => creditsFor(kind, mediaCost(kind, m.id)));
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

  const [image, video] = await Promise.all([cheapest("image"), cheapest("video")]);
  const body: BillingOptions = {
    limits: { free: limits("free"), pro: limits("pro") },
    budget: { free: planDailyUsd("free"), pro: planDailyUsd("pro") },
    // "From N credits": the cheapest picture and clip among the models on offer.
    credits: { packs, min: { ...MIN_CREDITS, image, video } },
    methods: {
      yookassa: yookassaConfigured() ? { price: yookassaPriceLabel() } : null,
      stripe,
    },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
