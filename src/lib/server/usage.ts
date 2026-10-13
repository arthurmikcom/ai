import { and, eq, sql } from "drizzle-orm";
import type { UsageKind, UsageSummary } from "@/lib/types";
import { isAdmin, type SessionUser } from "./auth";
import { getDb, schema } from "./db";

const DEFAULT_LIMITS: Record<UsageKind, number> = { chat: 50, image: 10, video: 2 };
const ENV_NAMES: Record<UsageKind, string> = {
  chat: "FREE_DAILY_CHAT",
  image: "FREE_DAILY_IMAGE",
  video: "FREE_DAILY_VIDEO",
};

/** Free-tier daily limit; null means unlimited. */
export function dailyLimit(user: SessionUser, kind: UsageKind): number | null {
  if (isAdmin(user.email)) return null;
  const raw = process.env[ENV_NAMES[kind]]?.trim();
  if (raw === "unlimited") return null;
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_LIMITS[kind];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const LIMIT_NAMES: Record<UsageKind, string> = {
  chat: "сообщения",
  image: "изображения",
  video: "видео",
};

export function limitMessage(kind: UsageKind, limit: number): string {
  return `Дневной лимит исчерпан (${LIMIT_NAMES[kind]}: ${limit} в сутки). Лимит обновится в полночь по UTC.`;
}

/**
 * Counts one use against today's limit. Returns false (and counts nothing)
 * when the limit is already reached. Atomic, so parallel requests can't
 * slip past the limit.
 */
export async function consume(user: SessionUser, kind: UsageKind): Promise<boolean> {
  const limit = dailyLimit(user, kind);
  const db = await getDb();
  if (limit === 0) return false;
  const rows = await db
    .insert(schema.usage)
    .values({ userId: user.id, day: today(), kind, count: 1 })
    .onConflictDoUpdate({
      target: [schema.usage.userId, schema.usage.day, schema.usage.kind],
      set: { count: sql`${schema.usage.count} + 1` },
      ...(limit === null ? {} : { setWhere: sql`${schema.usage.count} < ${limit}` }),
    })
    .returning({ count: schema.usage.count });
  return rows.length > 0;
}

/** Gives back a use when the provider failed before producing anything. */
export async function refund(userId: string, kind: UsageKind): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.usage)
    .set({ count: sql`greatest(${schema.usage.count} - 1, 0)` })
    .where(
      and(
        eq(schema.usage.userId, userId),
        eq(schema.usage.day, today()),
        eq(schema.usage.kind, kind),
      ),
    );
}

export async function usageSummary(user: SessionUser): Promise<UsageSummary> {
  const db = await getDb();
  const rows = await db
    .select({ kind: schema.usage.kind, count: schema.usage.count })
    .from(schema.usage)
    .where(and(eq(schema.usage.userId, user.id), eq(schema.usage.day, today())));
  const used = (kind: UsageKind) => rows.find((r) => r.kind === kind)?.count ?? 0;
  const kinds: UsageKind[] = ["chat", "image", "video"];
  return Object.fromEntries(
    kinds.map((k) => [k, { used: used(k), limit: dailyLimit(user, k) }]),
  ) as UsageSummary;
}
