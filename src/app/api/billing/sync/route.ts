import { isEntitled, getSubscription } from "@/lib/server/billing/plans";
import { stripeConfigured, stripeCreditsConfigured, syncStripeCredits, syncStripeForUser } from "@/lib/server/billing/stripe";
import { syncLatestYooKassaPayment, yookassaConfigured } from "@/lib/server/billing/yookassa";
import { describeError } from "@/lib/server/errors";
import { jsonError, requireUser } from "@/lib/server/http";

/**
 * Called when the user returns from a payment page: confirms the payment
 * with the provider right away instead of waiting for its webhook.
 * Body: { method: "yookassa" | "stripe" | "stripe-credits", sessionId? }
 * → { status: "succeeded" | "pending" | "failed", credits? } (credits: a pack of credits was bought).
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { method?: unknown; sessionId?: unknown } | null;
  try {
    if (body?.method === "yookassa" && yookassaConfigured()) {
      return Response.json(await syncLatestYooKassaPayment(user.id));
    }
    if (body?.method === "stripe" && stripeConfigured()) {
      await syncStripeForUser(user.id);
      return Response.json({ status: isEntitled(await getSubscription(user.id)) ? "succeeded" : "pending" });
    }
    if (body?.method === "stripe-credits" && stripeCreditsConfigured() && typeof body.sessionId === "string") {
      return Response.json({ status: await syncStripeCredits(user.id, body.sessionId), credits: true });
    }
    return jsonError("Этот способ оплаты не подключён", 400);
  } catch (err) {
    console.error("[billing] sync failed", err);
    return jsonError(describeError(err), 502);
  }
}
