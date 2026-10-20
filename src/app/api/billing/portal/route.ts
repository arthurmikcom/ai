import { siteOrigin } from "@/lib/server/billing/origin";
import { paddleCreditsConfigured, paddlePortalUrl } from "@/lib/server/billing/paddle";
import { getSubscription } from "@/lib/server/billing/plans";
import { stripeCreditsConfigured, stripePortalUrl } from "@/lib/server/billing/stripe";
import { describeError } from "@/lib/server/errors";
import { jsonError, requireUser } from "@/lib/server/http";

/** Link to the subscription's own portal — Stripe's or Paddle's (card, invoices, cancellation). */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const sub = await getSubscription(user.id);
  try {
    // Also when the plans are no longer sold there: existing subscribers still manage theirs.
    if (sub?.provider === "paddle" && paddleCreditsConfigured()) return Response.json({ url: await paddlePortalUrl(user.id) });
    if (stripeCreditsConfigured()) return Response.json({ url: await stripePortalUrl(user.id, siteOrigin(request)) });
    return jsonError("Управление подпиской недоступно: платёжная система не подключена", 400);
  } catch (err) {
    return jsonError(describeError(err), 400);
  }
}
