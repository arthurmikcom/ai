import { chargeRenewals, yookassaConfigured } from "@/lib/server/billing/yookassa";

export const maxDuration = 300;

/**
 * Daily job (vercel.json → crons) that charges YooKassa subscriptions due for
 * renewal. Vercel sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!yookassaConfigured()) return Response.json({ skipped: "yookassa not configured" });
  const result = await chargeRenewals();
  console.log("[cron] renewals", result);
  return Response.json(result);
}
