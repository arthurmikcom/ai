import { setAutoRenew } from "@/lib/server/billing/yookassa";
import { jsonError, requireUser } from "@/lib/server/http";

/** Turns off YooKassa auto-renewal; Pro stays until the paid period ends. */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return (await setAutoRenew(user.id, false))
    ? Response.json({ ok: true })
    : jsonError("Подписка с автопродлением не найдена", 404);
}
