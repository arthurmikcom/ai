// AI credits: a prepaid balance spent once the plan's daily limits are used up.
// A request holds its estimated cost when it starts (one credit per
// CREDIT_VALUE_USD of AI spending); when it ends, the real cost is settled:
// the unused part goes back, and anything above the estimate is taken even if
// that leaves the balance below zero — a debt that blocks further credit use
// until the next top-up.

import { desc, eq, sql } from "drizzle-orm";
import type { UsageKind } from "@/lib/types";
import { getDb, schema, type DB } from "../db";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** USD of AI cost one credit covers (CREDIT_VALUE_USD, default $0.002). */
export function creditValueUsd(): number {
  const value = Number.parseFloat(process.env.CREDIT_VALUE_USD ?? "");
  return Number.isFinite(value) && value > 0 ? value : 0.002;
}

/** The least one request takes from the balance, however cheap it was. */
export const MIN_CREDITS: Record<UsageKind, number> = { chat: 1, image: 5, video: 50, voice: 1 };

/** Credits for a request that cost `usd`. */
export function creditsFor(kind: UsageKind, usd: number): number {
  return Math.max(MIN_CREDITS[kind], Math.ceil(usd / creditValueUsd() - 1e-9));
}

export interface PackDef {
  id: string;
  credits: number;
  /** Price in roubles (ЮKassa); 0 when the pack isn't sold for roubles. */
  rub: number;
  /** Price in US dollars (Stripe); 0 when the pack isn't sold for dollars. */
  usd: number;
}

/** Packs on sale: CREDIT_PACKS="credits:rub:usd,…" (default below); a price may be left out. */
const DEFAULT_PACKS = "300:149:1.99,1000:399:4.99,5000:1690:19.99";

/** A plain non-negative number ("399", "4.99"); anything else (spaces, words) is not one. */
function price(raw: string | undefined): number | null {
  const text = raw?.trim() ?? "";
  if (!text) return 0;
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

function parsePacks(raw: string, warn: boolean): PackDef[] {
  const packs: PackDef[] = [];
  for (const part of raw.split(",")) {
    const [c, r, u] = part.trim().split(":");
    const credits = /^\d+$/.test(c?.trim() ?? "") ? Number(c) : NaN;
    const rub = price(r);
    const usd = price(u);
    if (credits > 0 && credits <= 1_000_000 && rub !== null && usd !== null && (rub > 0 || usd > 0)) {
      packs.push({ id: String(credits), credits, rub, usd });
    } else if (warn && part.trim()) {
      console.warn("[credits] CREDIT_PACKS: ignoring", JSON.stringify(part.trim()), "— expected credits:rub:usd");
    }
  }
  return [...new Map(packs.map((p) => [p.id, p])).values()].slice(0, 6);
}

export function creditPacks(): PackDef[] {
  const custom = process.env.CREDIT_PACKS?.trim();
  if (custom) {
    const packs = parsePacks(custom, true);
    if (packs.length) return packs;
    console.warn("[credits] CREDIT_PACKS has no valid pack; selling the default ones");
  }
  return parsePacks(DEFAULT_PACKS, false);
}

export function findPack(id: unknown): PackDef | undefined {
  return typeof id === "string" ? creditPacks().find((p) => p.id === id) : undefined;
}

export async function creditBalance(userId: string, tx?: Tx): Promise<number> {
  const db = tx ?? (await getDb());
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

/**
 * Takes up to `n` credits, as many as the balance has (none from a debt).
 * Atomic. Returns how many were taken.
 */
export async function holdUpTo(userId: string, n: number): Promise<number> {
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
 * Charges a cost worth a fraction of a credit (MARYX's titles and follow-ups):
 * fractions add up, and a whole credit is taken each time they reach one —
 * never into debt (what the balance can't pay waits for the next top-up).
 * Returns the whole credits taken now.
 */
export async function takeFraction(userId: string, credits: number): Promise<number> {
  if (!(credits > 0)) return 0;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ carry: schema.creditBalance.carry, balance: schema.creditBalance.balance })
      .from(schema.creditBalance)
      .where(eq(schema.creditBalance.userId, userId))
      .for("update");
    if (!row) return 0;
    const total = row.carry + credits;
    const whole = Math.min(Math.floor(total + 1e-9), Math.max(0, row.balance));
    await tx
      .update(schema.creditBalance)
      .set({ balance: sql`${schema.creditBalance.balance} - ${whole}`, carry: total - whole, updatedAt: new Date() })
      .where(eq(schema.creditBalance.userId, userId));
    return whole;
  });
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
 * Takes `n` more credits once a request's real cost is known, even when that
 * leaves the balance below zero: the debt is paid off by the next top-up, and
 * until then no request can hold credits. Returns how many were taken.
 */
export async function takeCredits(userId: string, n: number): Promise<number> {
  if (n <= 0) return 0;
  const db = await getDb();
  await db
    .insert(schema.creditBalance)
    .values({ userId, balance: -n })
    .onConflictDoUpdate({
      target: schema.creditBalance.userId,
      set: { balance: sql`${schema.creditBalance.balance} - ${n}`, updatedAt: new Date() },
    });
  return n;
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
