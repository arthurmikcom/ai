import { setAutoRenew } from "@/lib/server/billing/yookassa";
import { jsonError, requireUser } from "@/lib/server/http";

/** Turns YooKassa auto-renewal back on (needs a saved payment method). */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return (await setAutoRenew(user.id, true))
    ? Response.json({ ok: true })
    : jsonError("Карта для автопродления не сохранена — оформите подписку заново на странице тарифов", 400);
}
