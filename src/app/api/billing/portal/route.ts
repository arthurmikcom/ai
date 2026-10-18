import { siteOrigin } from "@/lib/server/billing/origin";
import { stripeCreditsConfigured, stripePortalUrl } from "@/lib/server/billing/stripe";
import { describeError } from "@/lib/server/errors";
import { jsonError, requireUser } from "@/lib/server/http";

/** Link to Stripe's customer portal (card, invoices, cancellation). */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  // Also when Pro is no longer sold through Stripe: existing subscribers still manage theirs.
  if (!stripeCreditsConfigured()) return jsonError("Stripe не подключён", 400);
  try {
    return Response.json({ url: await stripePortalUrl(user.id, siteOrigin(request)) });
  } catch (err) {
    return jsonError(describeError(err), 400);
  }
}
