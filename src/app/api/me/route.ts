import { isAdmin, socialProviders } from "@/lib/server/auth";
import { creditBalance } from "@/lib/server/billing/credits";
import { planInfo } from "@/lib/server/billing/info";
import { requireUser } from "@/lib/server/http";
import { ownKeyInfo } from "@/lib/server/own-key";
import { planDailyUsd, userSpendToday } from "@/lib/server/spend";
import { usageSummary } from "@/lib/server/usage";
import { transcriptionAvailable } from "@/lib/server/voice";
import type { MeResponse } from "@/lib/types";

/** The signed-in user, their plan, today's usage and limits, credits and own key. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const [plan, usage, credits, ownKey, spent] = await Promise.all([
    planInfo(user.id),
    usageSummary(user),
    creditBalance(user.id),
    ownKeyInfo(user.id),
    userSpendToday(user.id),
  ]);
  const body: MeResponse = {
    user: { id: user.id, name: user.name, email: user.email, image: user.image },
    admin: isAdmin(user),
    plan,
    usage,
    budget: { used: spent, limit: isAdmin(user) ? null : planDailyUsd(plan.id) },
    credits,
    ownKey,
    social: socialProviders(),
    voice: { transcribe: transcriptionAvailable(Boolean(ownKey)) },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
