// TON: the user sends TON from any wallet to the site's own wallet
// (TON_WALLET) with a short code in the comment; the site finds the transfer
// on the blockchain (TON Center API) and applies the purchase. No account with
// a payment provider is needed — only a wallet. A month of a plan or a pack of
// credits at a time: crypto can't be charged again by itself.

import { and, eq, gte } from "drizzle-orm";
import type { SessionUser } from "../auth";
import { getDb, schema } from "../db";
import { HttpError } from "../errors";
import type { TonPaymentInfo } from "@/lib/types";
import { getSubscription } from "./plans";
import { applyPurchase, createPurchase, findPurchase, oneOffBlock, oneOffPrice, oneOffTitle, setPurchaseStatus, type OneOffItem, type PurchaseRow } from "./oneoff";

/** The rate is held this long; the page asks to pay within it. */
const HOLD_MS = 30 * 60 * 1000;
/** A transfer arriving later (a slow wallet, a second try) is still taken for a day. */
const ACCEPT_MS = 24 * 60 * 60 * 1000;
const NANO_PER_CENT_TON = BigInt(10_000_000);

const env = (name: string) => process.env[name]?.trim() || undefined;

function wallet(): string | undefined {
  return env("TON_WALLET");
}

export function tonConfigured(): boolean {
  return Boolean(wallet());
}

/** TON Center's v3 API (TON_API_URL: testnet or a local mock). */
function api(): string {
  return (env("TON_API_URL") ?? "https://toncenter.com/api/v3").replace(/\/+$/, "");
}

let rate: { at: number; usd: number } | null = null;

/** TON's price in US dollars: tonapi.io, CoinGecko when it's down (TON_RATE_URL for a mock); cached 5 minutes. */
async function tonUsd(): Promise<number> {
  if (rate && Date.now() - rate.at < 5 * 60 * 1000) return rate.usd;
  const own = env("TON_RATE_URL");
  const sources = own
    ? [own]
    : ["https://tonapi.io/v2/rates?tokens=ton&currencies=usd", "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd"];
  for (const url of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const body = (await res.json()) as { rates?: { TON?: { prices?: { USD?: number } } }; "the-open-network"?: { usd?: number } };
      const usd = Number(body.rates?.TON?.prices?.USD ?? body["the-open-network"]?.usd);
      if (usd > 0) {
        rate = { at: Date.now(), usd };
        return usd;
      }
    } catch {
      // the next source
    }
  }
  throw new Error("Не удалось узнать курс TON — попробуйте через минуту");
}

/** "12.34" TON for an amount in nanotons. */
function tons(nano: bigint): string {
  return (Number(nano / NANO_PER_CENT_TON) / 100).toFixed(2);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** The comment a transfer must carry: "MX" and 8 letters/digits that can't be mistaken for each other. */
function newCode(): string {
  return `MX${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

/** Starts a TON purchase at the current rate; returns its id (the payment page is /pay/ton?id=<id>). */
export async function startTon(user: SessionUser, item: OneOffItem): Promise<string> {
  if (!tonConfigured()) throw new Error("Оплата в TON не подключена");
  const usd = oneOffPrice(item);
  if (typeof usd === "string") throw new Error(usd);
  const blocked = oneOffBlock(await getSubscription(user.id), item);
  if (blocked) throw new Error(blocked);
  // Rounded up to a hundredth of a TON, so the amount is easy to type in by hand.
  const cents = BigInt(Math.ceil((usd / (await tonUsd())) * 100));
  const row = await createPurchase(user.id, "ton", item, usd, {
    amount: (cents * NANO_PER_CENT_TON).toString(),
    currency: "TON",
    code: newCode(),
    expiresAt: new Date(Date.now() + HOLD_MS),
  });
  return row.id;
}

interface ChainTx {
  hash: string;
  now: number;
  in_msg?: {
    source?: string | null;
    value?: string | null;
    bounced?: boolean | null;
    message_content?: { decoded?: { type?: string; comment?: string } | null } | null;
  } | null;
  description?: { aborted?: boolean } | null;
}

interface Incoming {
  hash: string;
  value: bigint;
  comment: string;
  at: number;
}

let recent: { at: number; since: number; list: Incoming[] } | null = null;

/** Transfers to the wallet with a comment since `since` (ms), newest first; read at most every few seconds. */
async function incoming(since: number): Promise<Incoming[]> {
  if (recent && Date.now() - recent.at < 4000 && recent.since <= since) return recent.list;
  const params = new URLSearchParams({ account: wallet()!, limit: "256", sort: "desc", start_utime: String(Math.floor(since / 1000)) });
  const key = env("TONCENTER_API_KEY");
  const res = await fetch(`${api()}/transactions?${params}`, {
    headers: key ? { "X-API-Key": key } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new HttpError(res.status, `TON Center: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { transactions?: ChainTx[] };
  const list = (body.transactions ?? []).flatMap((tx): Incoming[] => {
    const m = tx.in_msg;
    const comment = m?.message_content?.decoded?.comment;
    // Only money that stayed: no bounces, no failed transactions, no external messages.
    if (!m?.source || !m.value || m.bounced || tx.description?.aborted || typeof comment !== "string") return [];
    return [{ hash: tx.hash, value: BigInt(m.value), comment: comment.trim().toUpperCase(), at: tx.now * 1000 }];
  });
  recent = { at: Date.now(), since, list };
  return list;
}

/** What came in with a purchase's code: one transfer, or a first one topped up by another. */
function received(list: Incoming[], row: PurchaseRow): { total: bigint; last?: Incoming } {
  const mine = list.filter((t) => t.comment === row.code);
  return { total: mine.reduce((sum, t) => sum + t.value, BigInt(0)), last: mine[0] };
}

/** The transfer completing a purchase: its code, and in all at least its amount (a wallet may round the last digit). */
function paying(list: Incoming[], row: PurchaseRow): Incoming | undefined {
  const { total, last } = received(list, row);
  return last && total * BigInt(1000) >= BigInt(row.amount) * BigInt(995) ? last : undefined;
}

/**
 * Looks for the transfers of pending TON purchases (one user's, or everyone's)
 * on the blockchain and applies the ones that arrived. Returns how many.
 */
export async function checkTonPayments(userId?: string): Promise<number> {
  if (!tonConfigured()) return 0;
  const db = await getDb();
  const pending = await db
    .select()
    .from(schema.purchase)
    .where(
      and(
        eq(schema.purchase.provider, "ton"),
        eq(schema.purchase.status, "pending"),
        gte(schema.purchase.createdAt, new Date(Date.now() - 2 * ACCEPT_MS)),
        userId ? eq(schema.purchase.userId, userId) : undefined,
      ),
    );
  if (!pending.length) return 0;
  const list = await incoming(Math.min(...pending.map((p) => p.createdAt.getTime())) - 60_000);
  let applied = 0;
  for (const row of pending) {
    const tx = paying(list, row);
    if (tx) {
      try {
        if (await applyPurchase(row.id, tx.hash)) applied++;
      } catch (err) {
        // e.g. the same transfer claimed twice (its hash is unique): logged, the rest go on.
        console.error("[ton] failed to apply", row.id, err);
      }
    } else if (Date.now() - row.createdAt.getTime() > ACCEPT_MS) {
      await setPurchaseStatus(row.id, "expired");
    }
  }
  return applied;
}

/** A TON purchase as its page shows it; looks on the blockchain first while it's pending. */
export async function tonPayment(userId: string, id: string): Promise<TonPaymentInfo | undefined> {
  let row = await findPurchase(userId, id);
  if (!row || row.provider !== "ton" || !row.code) return undefined;
  let short: string | undefined;
  if (row.status === "pending" && tonConfigured()) {
    try {
      await checkTonPayments(userId);
      row = (await findPurchase(userId, id)) ?? row;
      if (row.status === "pending") {
        const { total } = received(await incoming(row.createdAt.getTime() - 60_000), row);
        if (total > BigInt(0)) short = tons(total);
      }
    } catch (err) {
      // TON Center unreachable for a moment: the page asks again shortly.
      console.error("[ton] check failed", err);
    }
  }
  const address = wallet() ?? "";
  const query = `amount=${row.amount}&text=${encodeURIComponent(row.code!)}`;
  return {
    id: row.id,
    status: row.status,
    what: oneOffTitle(row),
    usd: row.usd,
    ton: tons(BigInt(row.amount)),
    address,
    code: row.code!,
    expiresAt: row.expiresAt?.getTime() ?? row.createdAt.getTime() + HOLD_MS,
    links: { ton: `ton://transfer/${address}?${query}`, tonkeeper: `https://app.tonkeeper.com/transfer/${address}?${query}` },
    ...(short ? { short } : {}),
  };
}
