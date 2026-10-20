// The plans (like other AI services' tiers): their names and order, for the
// browser and the server alike. Limits and prices are the server's
// (server/billing/plans.ts), set by environment variables.

import type { PaidPlanId, PlanId } from "./types";

export const PLAN_ORDER: PlanId[] = ["free", "plus", "pro", "ultra"];

export const PAID_PLANS: PaidPlanId[] = ["plus", "pro", "ultra"];

export const PLAN_NAMES: Record<PlanId, string> = { free: "Бесплатный", plus: "Plus", pro: "Pro", ultra: "Ultra" };

export const PLAN_TAGLINES: Record<PlanId, string> = {
  free: "Чтобы попробовать",
  plus: "Для учёбы и личных задач",
  pro: "Для тех, кто работает с ИИ каждый день",
  ultra: "Для создателей контента и команд",
};

export function isPaidPlan(value: unknown): value is PaidPlanId {
  return typeof value === "string" && (PAID_PLANS as string[]).includes(value);
}

/** A higher plan than `than` (an upgrade, not a downgrade). */
export function planRank(id: PlanId): number {
  return PLAN_ORDER.indexOf(id);
}
