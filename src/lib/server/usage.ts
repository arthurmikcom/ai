import { and, eq, sql } from "drizzle-orm";
import type { UsageKind, UsageSummary } from "@/lib/types";
import { isAdmin, type SessionUser } from "./auth";
import { currentPlan, planLimit } from "./billing/plans";
import { getDb, schema } from "./db";

/** Today's limit for this user; null means unlimited. */
export async function dailyLimit(user: SessionUser, kind: UsageKind): Promise<number | null> {
  if (isAdmin(user)) return null;
  const { plan } = await currentPlan(user.id);
  return planLimit(plan, kind);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const LIMIT_NAMES: Record<UsageKind, string> = {
  chat: "сообщения",
  image: "изображения",
  video: "видео",
};

/** Error body for a reached limit; `code` lets the UI offer an upgrade. */
export async function limitResponse(user: SessionUser, kind: UsageKind): Promise<Response> {
  const limit = (await dailyLimit(user, kind)) ?? 0;
  const { plan } = await currentPlan(user.id);
  const hint = plan === "free" ? " Оформите Pro, чтобы получить больше." : "";
  return Response.json(
    {
      error: `Дневной лимит исчерпан (${LIMIT_NAMES[kind]}: ${limit} в сутки). Лимит обновится в полночь по UTC.${hint}`,
      code: "limit",
    },
    { status: 429 },
  );
}

/**
 * Counts one use against today's limit. Returns false (and counts nothing)
 * when the limit is already reached. Atomic, so parallel requests can't
 * slip past the limit.
 */
export async function consume(user: SessionUser, kind: UsageKind): Promise<boolean> {
  const limit = await dailyLimit(user, kind);
  if (limit === 0) return false;
  const db = await getDb();
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
  const admin = isAdmin(user);
  const { plan } = await currentPlan(user.id);
  const used = (kind: UsageKind) => rows.find((r) => r.kind === kind)?.count ?? 0;
  const limit = (kind: UsageKind) => (admin ? null : planLimit(plan, kind));
  const kinds: UsageKind[] = ["chat", "image", "video"];
  return Object.fromEntries(kinds.map((k) => [k, { used: used(k), limit: limit(k) }])) as UsageSummary;
}

