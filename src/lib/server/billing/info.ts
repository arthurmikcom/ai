import type { PlanInfo } from "@/lib/types";
import { currentPlan } from "./plans";

/** The user's plan as shown in the UI. */
export async function planInfo(userId: string): Promise<PlanInfo> {
  const { plan, sub } = await currentPlan(userId);
  if (!sub) return { id: plan };
  return {
    id: plan,
    provider: sub.provider,
    periodEnd: sub.currentPeriodEnd.getTime(),
    endsAtPeriodEnd:
      sub.provider === "promo" ||
      sub.cancelAtPeriodEnd ||
      // No saved card (declined for good, or the method couldn't be saved).
      (sub.provider === "yookassa" && !sub.yookassaPaymentMethodId),
    status: sub.status,
  };
}
