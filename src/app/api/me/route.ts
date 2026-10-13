import { isAdmin, socialProviders } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/http";
import { usageSummary } from "@/lib/server/usage";
import type { MeResponse } from "@/lib/types";

/** The signed-in user, today's usage and limits. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body: MeResponse = {
    user: { id: user.id, name: user.name, email: user.email, image: user.image },
    admin: isAdmin(user.email),
    usage: await usageSummary(user),
    social: socialProviders(),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
