import { findPack } from "@/lib/server/billing/credits";
import { siteOrigin } from "@/lib/server/billing/origin";
import { paddleCreditsConfigured, startPaddleCredits } from "@/lib/server/billing/paddle";
import { paypalConfigured, startPayPal } from "@/lib/server/billing/paypal";
import { startStripeCredits, stripeCreditsConfigured } from "@/lib/server/billing/stripe";
import { startTon, tonConfigured } from "@/lib/server/billing/ton";
import { startYooKassaCredits, yookassaConfigured } from "@/lib/server/billing/yookassa";
import { describeError } from "@/lib/server/errors";
import { jsonError, requireUser } from "@/lib/server/http";

/** Starts buying a pack of AI credits: { method: "yookassa" | "stripe" | "paddle" | "paypal" | "ton", pack } → { url } of the payment page. */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { method?: unknown; pack?: unknown } | null;
  const pack = findPack(body?.pack);
  if (!pack) return jsonError("Такого пакета кредитов нет", 400);

  try {
    const origin = siteOrigin(request);
    if (body?.method === "yookassa" && yookassaConfigured()) {
      return Response.json({ url: await startYooKassaCredits(user, origin, pack) });
    }
    if (body?.method === "stripe" && stripeCreditsConfigured()) {
      return Response.json({ url: await startStripeCredits(user, origin, pack) });
    }
    if (body?.method === "paddle" && paddleCreditsConfigured()) {
      return Response.json({ url: await startPaddleCredits(user, origin, pack) });
    }
    if (body?.method === "paypal" && paypalConfigured()) return Response.json({ url: await startPayPal(user, origin, { pack }) });
    if (body?.method === "ton" && tonConfigured()) return Response.json({ url: `${origin}/pay/ton?id=${await startTon(user, { pack })}` });
    return jsonError("Этот способ оплаты не подключён", 400);
  } catch (err) {
    console.error("[billing] credits checkout failed", err);
    return jsonError(describeError(err), 502);
  }
}
