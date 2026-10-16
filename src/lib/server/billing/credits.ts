// AI credits: a prepaid balance spent once the plan's daily limits are used up.
// A request holds the least it can cost when it starts; when it ends, the rest
// of its real cost (one credit per CREDIT_VALUE_USD of AI spending) is taken.

import { desc, eq, sql } from "drizzle-orm";
import type { UsageKind } from "@/lib/types";
import { getDb, schema, type DB } from "../db";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** USD of AI cost one credit covers (CREDIT_VALUE_USD, default $0.002). */
export function creditValueUsd(): number {
  const value = Number.parseFloat(process.env.CREDIT_VALUE_USD ?? "");
  return Number.isFinite(value) && value > 0 ? value : 0.002;
}

/** The least one request takes from the balance; its real cost decides above that. */
export const MIN_CREDITS: Record<UsageKind, number> = { chat: 1, image: 5, video: 50, voice: 1 };

/** Credits for a request that cost `usd`. */
export function creditsFor(kind: UsageKind, usd: number): number {
  return Math.max(MIN_CREDITS[kind], Math.ceil(usd / creditValueUsd() - 1e-9));
}

export interface PackDef {
  id: string;
  credits: number;
  /** Price in roubles (ЮKassa). */
  rub: number;
  /** Price in US dollars (Stripe). */
  usd: number;
}

/** Packs on sale: CREDIT_PACKS="credits:rub:usd,…" (default below). */
const DEFAULT_PACKS = "300:149:1.99,1000:399:4.99,5000:1690:19.99";

export function creditPacks(): PackDef[] {
  const parse = (raw: string) =>
    raw
      .split(",")
      .map((part) => part.trim().split(":").map((n) => Number.parseFloat(n)))
      .filter(
        ([credits, rub, usd]) =>
          Number.isInteger(credits) && credits > 0 && credits <= 1_000_000 && rub > 0 && usd > 0,
      )
      .map(([credits, rub, usd]) => ({ id: String(credits), credits, rub, usd }));
  const packs = parse(process.env.CREDIT_PACKS?.trim() || DEFAULT_PACKS);
  const unique = [...new Map(packs.map((p) => [p.id, p])).values()];
  return unique.length ? unique.slice(0, 6) : parse(DEFAULT_PACKS);
}

export function findPack(id: unknown): PackDef | undefined {
  return typeof id === "string" ? creditPacks().find((p) => p.id === id) : undefined;
}

export async function creditBalance(userId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ balance: schema.creditBalance.balance })
    .from(schema.creditBalance)
    .where(eq(schema.creditBalance.userId, userId));
  return row?.balance ?? 0;
}

/** Takes `n` credits if the balance has them. Atomic, so parallel requests can't overdraw. */
export async function holdCredits(userId: string, n: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(schema.creditBalance)
    .set({ balance: sql`${schema.creditBalance.balance} - ${n}`, updatedAt: new Date() })
    .where(sql`${schema.creditBalance.userId} = ${userId} and ${schema.creditBalance.balance} >= ${n}`)
    .returning({ balance: schema.creditBalance.balance });
  return rows.length > 0;
}

/** Gives held credits back (the request failed before producing anything). */
export async function releaseCredits(userId: string, n: number): Promise<void> {
  if (n <= 0) return;
  const db = await getDb();
  await db
    .update(schema.creditBalance)
    .set({ balance: sql`${schema.creditBalance.balance} + ${n}`, updatedAt: new Date() })
    .where(eq(schema.creditBalance.userId, userId));
}

/**
 * Takes up to `n` more credits once a request's real cost is known. A request
 * that cost more than the balance had left empties it rather than going negative.
 * Returns how many were taken.
 */
export async function takeCredits(userId: string, n: number): Promise<number> {
  if (n <= 0) return 0;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ balance: schema.creditBalance.balance })
      .from(schema.creditBalance)
      .where(eq(schema.creditBalance.userId, userId))
      .for("update");
    const taken = Math.min(n, Math.max(0, row?.balance ?? 0));
    if (taken > 0) {
      await tx
        .update(schema.creditBalance)
        .set({ balance: sql`${schema.creditBalance.balance} - ${taken}`, updatedAt: new Date() })
        .where(eq(schema.creditBalance.userId, userId));
    }
    return taken;
  });
}

/**
 * Adds credits once per `id` (a payment, a checkout session, a promo
 * redemption…). Returns false when that id was already credited. Pass the
 * transaction when the grant must commit together with other changes.
 */
export async function grantCredits(
  grant: { id: string; userId: string; credits: number; source: "yookassa" | "stripe" | "promo" | "admin"; note?: string },
  tx?: Tx,
): Promise<boolean> {
  if (!Number.isInteger(grant.credits) || grant.credits <= 0) return false;
  const run = async (t: Tx) => {
    const inserted = await t
      .insert(schema.creditGrant)
      .values({ ...grant, note: grant.note?.slice(0, 200) ?? null })
      .onConflictDoNothing()
      .returning({ id: schema.creditGrant.id });
    if (!inserted.length) return false;
    await t
      .insert(schema.creditBalance)
      .values({ userId: grant.userId, balance: grant.credits })
      .onConflictDoUpdate({
        target: schema.creditBalance.userId,
        set: { balance: sql`${schema.creditBalance.balance} + ${grant.credits}`, updatedAt: new Date() },
      });
    return true;
  };
  if (tx) return run(tx);
  const db = await getDb();
  return db.transaction(run);
}

/** The latest top-ups of a user (settings page). */
export async function recentGrants(userId: string, limit = 10) {
  const db = await getDb();
  return db
    .select({ credits: schema.creditGrant.credits, source: schema.creditGrant.source, createdAt: schema.creditGrant.createdAt })
    .from(schema.creditGrant)
    .where(eq(schema.creditGrant.userId, userId))
    .orderBy(desc(schema.creditGrant.createdAt))
    .limit(limit);
}
