import { PAID_PLANS, PLAN_ORDER } from "@/lib/plans";
import { creditsFor, MIN_CREDITS } from "@/lib/server/billing/credits";
import { sellablePacks } from "@/lib/server/billing/packs";
import { maryxMediaModel } from "@/lib/server/chat/image";
import { freePlanFreeImages, maryxOnly } from "@/lib/server/config";
import { listModels } from "@/lib/server/models";
import { mediaCost } from "@/lib/server/pricing";
import { planDailyUsd, planMonthlyMediaUsd } from "@/lib/server/spend";
import { planLimit, planPriceSetting } from "@/lib/server/billing/plans";
import { stripeConfigured, stripeCreditsConfigured, stripePriceLabel, stripeSells } from "@/lib/server/billing/stripe";
import { yookassaConfigured, yookassaPriceLabel } from "@/lib/server/billing/yookassa";
import { requireUser } from "@/lib/server/http";
import { USAGE_KINDS, type BillingOptions, type PaidPlanId, type PlanId, type UsageKind } from "@/lib/types";

/** What MARYX makes a picture or a clip with on paid plans (in MARYX-only mode), or every model on offer. */
async function paidModels(kind: "image" | "video"): Promise<string[]> {
  const { models } = maryxOnly()
    ? await maryxMediaModel(kind).then((m) => ({ models: [m] }), () => ({ models: [] }))
    : await listModels(kind).catch(() => ({ models: [] }));
  return models.map((m) => m.id);
}

/** Plans, their limits and the payment methods this server accepts. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const each = <T,>(f: (plan: PlanId) => T) => Object.fromEntries(PLAN_ORDER.map((p) => [p, f(p)])) as Record<PlanId, T>;
  const eachPaid = <T,>(f: (plan: PaidPlanId) => T) => Object.fromEntries(PAID_PLANS.map((p) => [p, f(p)])) as Record<PaidPlanId, T>;
  const limits = (plan: PlanId) =>
    Object.fromEntries(USAGE_KINDS.map((k) => [k, planLimit(plan, k)])) as Record<UsageKind, number | null>;

  let stripe: BillingOptions["methods"]["stripe"] = null;
  if (stripeConfigured()) {
    try {
      const sold = PAID_PLANS.filter(stripeSells);
      const labels = await Promise.all(sold.map((p) => stripePriceLabel(p)));
      stripe = { prices: Object.fromEntries(sold.map((p, i) => [p, labels[i]])) };
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

  // "From N credits": the cheapest picture and clip among the models on offer; a plan's month: about how many of them.
  const [images, videos] = await Promise.all([paidModels("image"), paidModels("video")]);
  const cheapest = (kind: "image" | "video", ids: string[]) => (ids.length ? Math.min(...ids.map((id) => mediaCost(kind, id))) : 0);
  const [image, video] = [cheapest("image", images), cheapest("video", videos)];
  const media = (plan: PlanId) => {
    const usdPerMonth = planMonthlyMediaUsd(plan);
    if (usdPerMonth === null) return null;
    return { images: image > 0 ? Math.floor(usdPerMonth / image) : 0, videos: video > 0 ? Math.floor(usdPerMonth / video) : 0 };
  };
  const body: BillingOptions = {
    limits: each(limits),
    budget: each(planDailyUsd),
    media: each(media),
    freeImages: freePlanFreeImages(),
    credits: {
      packs,
      min: { ...MIN_CREDITS, image: images.length ? creditsFor("image", image) : MIN_CREDITS.image, video: videos.length ? creditsFor("video", video) : MIN_CREDITS.video },
    },
    methods: {
      yookassa: yookassaConfigured() ? { price: yookassaPriceLabel() } : null,
      stripe,
    },
    prices: eachPaid((p) => stripe?.prices[p] ?? (planPriceSetting(p).usd > 0 ? money(planPriceSetting(p).usd, "USD") : null)),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
