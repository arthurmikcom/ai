// PayPal: a month of a plan or a pack of credits, paid once (no automatic
// renewal). The buyer approves the order on PayPal; the money is taken when
// our server captures it — on the return to the site, or from the webhook if
// the buyer never came back. Webhook bodies aren't trusted: the order is
// always re-read from PayPal with our own credentials.

import { and, eq } from "drizzle-orm";
import type { SessionUser } from "../auth";
import { getDb, schema } from "../db";
import { HttpError } from "../errors";
import { getSubscription } from "./plans";
import { applyPurchase, createPurchase, oneOffBlock, oneOffPrice, oneOffTitle, setPurchaseStatus, type OneOffItem, type PurchaseRow } from "./oneoff";

const env = (name: string) => process.env[name]?.trim() || undefined;

export function paypalConfigured(): boolean {
  return Boolean(env("PAYPAL_CLIENT_ID") && env("PAYPAL_CLIENT_SECRET"));
}

/** PAYPAL_MODE=sandbox for test accounts; live otherwise (PAYPAL_API_URL: a local mock). */
export function paypalSandbox(): boolean {
  return env("PAYPAL_MODE") === "sandbox";
}

function base(): string {
  return (env("PAYPAL_API_URL") ?? (paypalSandbox() ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com")).replace(/\/+$/, "");
}

let token: { value: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const auth = Buffer.from(`${env("PAYPAL_CLIENT_ID")}:${env("PAYPAL_CLIENT_SECRET")}`).toString("base64");
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new HttpError(res.status, `PayPal не принял ключи (${res.status}) — проверьте PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET и PAYPAL_MODE`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, until: Date.now() + Math.max(60, body.expires_in - 120) * 1000 };
  return token.value;
}

interface PayPalError {
  name?: string;
  message?: string;
  details?: { issue?: string; description?: string }[];
}

async function pp<T>(path: string, init?: { method: "POST"; body?: unknown; requestId: string }): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      // The same request id makes a retried request do nothing twice.
      ...(init ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as PayPalError | null;
    const issue = err?.details?.[0]?.issue;
    throw Object.assign(new HttpError(res.status, `PayPal: ${err?.details?.[0]?.description ?? err?.message ?? res.statusText}`), { issue });
  }
  return (await res.json()) as T;
}

interface PayPalOrder {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  links?: { href: string; rel: string }[];
  purchase_units?: {
    custom_id?: string;
    payments?: { captures?: { id: string; status: string; amount?: { value: string; currency_code: string } }[] };
  }[];
}

/** Starts a PayPal order and returns the page where the buyer approves it. */
export async function startPayPal(user: SessionUser, origin: string, item: OneOffItem): Promise<string> {
  if (!paypalConfigured()) throw new Error("PayPal не подключён");
  const usd = oneOffPrice(item);
  if (typeof usd === "string") throw new Error(usd);
  const blocked = oneOffBlock(await getSubscription(user.id), item);
  if (blocked) throw new Error(blocked);
  const row = await createPurchase(user.id, "paypal", item, usd, { amount: usd.toFixed(2), currency: "USD" });
  const order = await pp<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    requestId: `order-${row.id}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: row.id,
          description: oneOffTitle(row),
          amount: { currency_code: "USD", value: row.amount },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "MARYX Ai",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: `${origin}/settings?billing=paypal`,
            cancel_url: `${origin}/pricing`,
          },
        },
      },
    },
  });
  const db = await getDb();
  await db.update(schema.purchase).set({ externalId: order.id }).where(eq(schema.purchase.id, row.id));
  const url = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!url) throw new Error("PayPal не вернул ссылку на оплату");
  return url;
}

/** Whether a completed order paid what the purchase asked. */
function paidInFull(order: PayPalOrder, row: PurchaseRow): boolean {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  return (
    order.status === "COMPLETED" &&
    capture?.status === "COMPLETED" &&
    capture.amount?.currency_code === "USD" &&
    Number(capture.amount.value) >= Number(row.amount)
  );
}

/**
 * Takes the money of an approved order and applies its purchase, once.
 * A month of a plan isn't captured while a subscription that renews by
 * itself has started meanwhile: nothing is charged then.
 */
async function captureOrder(row: PurchaseRow): Promise<"succeeded" | "pending" | "failed"> {
  if (row.appliedAt) return "succeeded";
  if (row.status !== "pending" || !row.externalId) return "failed";
  if (oneOffBlock(await getSubscription(row.userId), row)) {
    await setPurchaseStatus(row.id, "failed");
    return "failed";
  }
  let order: PayPalOrder;
  try {
    order = await pp<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(row.externalId)}/capture`, { method: "POST", requestId: `capture-${row.id}` });
  } catch (err) {
    const issue = (err as { issue?: string }).issue;
    if (issue === "ORDER_ALREADY_CAPTURED") order = await pp<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(row.externalId)}`);
    // Not approved yet (the buyer left PayPal's page): nothing was taken.
    else if (issue === "ORDER_NOT_APPROVED") return "pending";
    else if (issue === "INSTRUMENT_DECLINED" || issue === "ORDER_EXPIRED" || issue === "ORDER_COMPLETED_OR_VOIDED") {
      await setPurchaseStatus(row.id, "failed");
      return "failed";
    } else throw err;
  }
  if (paidInFull(order, row)) {
    await applyPurchase(row.id);
    return "succeeded";
  }
  // e.g. an eCheck: PayPal reports the capture completed later (webhook).
  const status = order.purchase_units?.[0]?.payments?.captures?.[0]?.status;
  if (status === "PENDING") return "pending";
  if (order.status === "COMPLETED") console.error("[paypal] captured, but not as ordered", row.id, JSON.stringify(order.purchase_units?.[0]?.payments));
  return "failed";
}

/** Back from PayPal (…?billing=paypal&token=<order id>): capture the user's own order. */
export async function syncPayPal(userId: string, orderId: string): Promise<{ status: "succeeded" | "pending" | "failed"; credits: boolean }> {
  if (!/^[A-Z0-9]{5,40}$/.test(orderId)) return { status: "failed", credits: false };
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.purchase)
    .where(and(eq(schema.purchase.externalId, orderId), eq(schema.purchase.userId, userId), eq(schema.purchase.provider, "paypal")));
  if (!row) return { status: "failed", credits: false };
  return { status: await captureOrder(row), credits: row.kind === "credits" };
}

/**
 * PayPal webhooks: an order the buyer approved but never came back from is
 * captured here; a capture completed later (eCheck) is applied. Returns an HTTP status.
 */
export async function handlePayPalWebhook(body: unknown): Promise<number> {
  const event = body as { event_type?: string; resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } } } | null;
  const orderId =
    event?.event_type === "CHECKOUT.ORDER.APPROVED"
      ? event.resource?.id
      : event?.event_type === "PAYMENT.CAPTURE.COMPLETED"
        ? event.resource?.supplementary_data?.related_ids?.order_id
        : undefined;
  if (!event?.event_type) return 400;
  if (typeof orderId !== "string" || !/^[A-Z0-9]{5,40}$/.test(orderId)) return 200;
  const db = await getDb();
  const [row] = await db.select().from(schema.purchase).where(and(eq(schema.purchase.externalId, orderId), eq(schema.purchase.provider, "paypal")));
  if (!row || row.appliedAt) return 200;
  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
    await captureOrder(row);
    return 200;
  }
  const order = await pp<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  if (paidInFull(order, row)) await applyPurchase(row.id);
  return 200;
}
