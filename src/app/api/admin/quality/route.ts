import { requireAdmin } from "@/lib/server/http";
import { qualityReport } from "@/lib/server/quality";

/** How users rate MARYX's answers over the last 30 days: per model, why the 👎, the latest 👎. */
export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  return Response.json(await qualityReport(), { headers: { "Cache-Control": "no-store" } });
}
