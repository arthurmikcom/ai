import { handleYooKassaWebhook, yookassaConfigured } from "@/lib/server/billing/yookassa";

/**
 * YooKassa HTTP notifications. They aren't signed, so the handler only takes
 * the payment id from the body and re-reads the payment from the YooKassa API.
 */
export async function POST(request: Request) {
  if (!yookassaConfigured()) return new Response("ЮKassa не подключена", { status: 404 });
  const status = await handleYooKassaWebhook(await request.json().catch(() => null));
  return new Response(status === 200 ? "ok" : "invalid", { status });
}
