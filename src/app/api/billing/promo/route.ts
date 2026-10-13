import { redeemPromo } from "@/lib/server/billing/promo";
import { jsonError, requireUser } from "@/lib/server/http";

/** Activates a promo code for the signed-in user. */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  if (typeof body?.code !== "string" || !body.code.trim()) return jsonError("Введите промокод", 400);
  const result = await redeemPromo(user.id, body.code);
  return typeof result === "string"
    ? jsonError(result, 400)
    : Response.json({ ok: true, until: result.getTime() });
}
