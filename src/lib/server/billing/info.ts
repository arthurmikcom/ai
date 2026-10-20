import type { PlanInfo } from "@/lib/types";
import { currentPlan, hasLiveStripe, needsYooKassaRepay } from "./plans";
import { nextChargeAt } from "./yookassa";

/** The user's plan as shown in the UI. */
export async function planInfo(userId: string): Promise<PlanInfo> {
  const { plan, sub } = await currentPlan(userId);
  if (!sub) return { id: plan };
  const endsAtPeriodEnd =
    sub.provider === "promo" ||
    sub.cancelAtPeriodEnd ||
    // No saved card (declined for good, or the method couldn't be saved).
    (sub.provider === "yookassa" && !sub.yookassaPaymentMethodId);
  return {
    id: plan,
    provider: sub.provider,
    periodEnd: sub.currentPeriodEnd.getTime(),
    endsAtPeriodEnd,
    // YooKassa renewals are charged by the daily run up to a day early.
    renewsAt: endsAtPeriodEnd
      ? undefined
      : sub.provider === "yookassa"
        ? nextChargeAt(sub.currentPeriodEnd).getTime()
        : sub.currentPeriodEnd.getTime(),
    status: sub.status,
    stripeLive: hasLiveStripe(sub),
    cardSaved: sub.provider === "yookassa" && Boolean(sub.yookassaPaymentMethodId),
    repay: plan !== "free" && needsYooKassaRepay(sub),
  };
}
