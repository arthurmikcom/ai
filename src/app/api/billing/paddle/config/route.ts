import { paddleClientConfig, paddleCustomerId } from "@/lib/server/billing/paddle";
import { jsonError, requireUser } from "@/lib/server/http";

/** What the checkout page needs to open Paddle's checkout (the client token is public by design). */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const config = paddleClientConfig();
  if (!config) return jsonError("Paddle не подключён", 404);
  // Paddle Retain recognizes the signed-in customer by their Paddle customer id.
  return Response.json({ ...config, customer: (await paddleCustomerId(user.id)) ?? null }, { headers: { "Cache-Control": "no-store" } });
}
