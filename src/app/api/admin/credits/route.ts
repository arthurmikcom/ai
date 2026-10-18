import { eq, sql } from "drizzle-orm";
import { grantCredits, revokeCredits } from "@/lib/server/billing/credits";
import { getDb, schema } from "@/lib/server/db";
import { jsonError, requireAdmin } from "@/lib/server/http";

/**
 * Adds credits to a user's balance, or with a negative number takes them back
 * (e.g. after a refund; only what's still on the balance): { email, credits, note? } → { ok, balance, taken? }.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const credits = Number(body?.credits);
  if (!email) return jsonError("Укажите почту пользователя", 400);
  if (!Number.isInteger(credits) || credits === 0 || Math.abs(credits) > 1_000_000) {
    return jsonError("Кредитов: от 1 до 1 000 000 (со знаком минус — списать)", 400);
  }

  const db = await getDb();
  const [user] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${email.toLowerCase()}`);
  if (!user) return jsonError("Пользователь с такой почтой не найден", 404);

  const note = typeof body?.note === "string" ? body.note : `от ${admin.email}`;
  const taken =
    credits < 0
      ? await revokeCredits({ userId: user.id, credits: -credits, note })
      : (await grantCredits({ id: `admin:${crypto.randomUUID()}`, userId: user.id, credits, source: "admin", note }), undefined);
  const [row] = await db
    .select({ balance: schema.creditBalance.balance })
    .from(schema.creditBalance)
    .where(eq(schema.creditBalance.userId, user.id));
  return Response.json({ ok: true, balance: row?.balance ?? 0, ...(taken !== undefined ? { taken } : {}) });
}
