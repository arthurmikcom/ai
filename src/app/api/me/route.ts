import { isAdmin, socialProviders } from "@/lib/server/auth";
import { planInfo } from "@/lib/server/billing/info";
import { requireUser } from "@/lib/server/http";
import { usageSummary } from "@/lib/server/usage";
import { transcriptionAvailable } from "@/lib/server/voice";
import type { MeResponse } from "@/lib/types";

/** The signed-in user, their plan, today's usage and limits. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const [plan, usage] = await Promise.all([planInfo(user.id), usageSummary(user)]);
  const body: MeResponse = {
    user: { id: user.id, name: user.name, email: user.email, image: user.image },
    admin: isAdmin(user),
    plan,
    usage,
    social: socialProviders(),
    voice: { transcribe: transcriptionAvailable() },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
