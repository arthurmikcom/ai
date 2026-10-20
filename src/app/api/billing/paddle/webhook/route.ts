import { handlePaddleWebhook, paddleCreditsConfigured } from "@/lib/server/billing/paddle";

/** Paddle notifications. Authenticated by the Paddle-Signature header (PADDLE_WEBHOOK_SECRET). */
export async function POST(request: Request) {
  if (!paddleCreditsConfigured()) return new Response("Paddle не подключён", { status: 404 });
  const status = await handlePaddleWebhook(await request.text(), request.headers.get("paddle-signature"));
  return new Response(status === 200 ? "ok" : "invalid", { status });
}
