import { requireAdmin } from "@/lib/server/http";
import { costReport } from "@/lib/server/spend";

/** What AI requests cost the site: totals, by day, model, user, kind and payer. */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  return Response.json(await costReport(), { headers: { "Cache-Control": "no-store" } });
}
