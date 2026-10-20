import { tonPayment } from "@/lib/server/billing/ton";
import { jsonError, requireUser } from "@/lib/server/http";

type Context = { params: Promise<{ id: string }> };

/** A TON purchase of the user's: what to send where, and whether it has arrived (looked up on the blockchain). */
export async function GET(request: Request, { params }: Context) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const payment = await tonPayment(user.id, (await params).id);
  return payment ? Response.json(payment, { headers: { "Cache-Control": "no-store" } }) : jsonError("Платёж не найден", 404);
}
