import { randomInt } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { PromoCode } from "@/lib/types";
import { getDb, schema } from "../db";
import { isEntitled } from "./plans";

const CODE_PATTERN = /^[A-Z0-9-]{4,40}$/;
// No 0/O, 1/I/L: codes are typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function randomCode(): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `NEXUS-${part()}-${part()}`;
}

function toPromo(row: typeof schema.promoCode.$inferSelect): PromoCode {
  return {
    code: row.code,
    days: row.days,
    maxUses: row.maxUses,
    uses: row.uses,
    note: row.note ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}

export async function listPromos(): Promise<PromoCode[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.promoCode).orderBy(desc(schema.promoCode.createdAt)).limit(500);
  return rows.map(toPromo);
}

export async function createPromo(input: {
  code?: string;
  days: number;
  maxUses: number;
  note?: string;
}): Promise<PromoCode | string> {
  const code = input.code ? normalizeCode(input.code) : randomCode();
  if (!CODE_PATTERN.test(code)) return "Код: 4–40 символов, латиница, цифры и дефис";
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 3650) return "Дней: от 1 до 3650";
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 100_000) {
    return "Активаций: от 1 до 100 000";
  }
  const db = await getDb();
  const rows = await db
    .insert(schema.promoCode)
    .values({ code, days: input.days, maxUses: input.maxUses, note: input.note?.slice(0, 200) || null })
    .onConflictDoNothing()
    .returning();
  return rows[0] ? toPromo(rows[0]) : "Такой код уже существует";
}

export async function deletePromo(code: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .delete(schema.promoCode)
    .where(eq(schema.promoCode.code, normalizeCode(code)))
    .returning({ code: schema.promoCode.code });
  return rows.length > 0;
}

class RedeemError extends Error {}

/** Grants Pro for the code's days. Returns the new end of the paid period, or an error message. */
export async function redeemPromo(userId: string, rawCode: string): Promise<Date | string> {
  const code = normalizeCode(rawCode);
  if (!CODE_PATTERN.test(code)) return "Промокод не найден";
  const db = await getDb();
  try {
    return await db.transaction(async (tx) => {
      // The row lock makes parallel redemptions of one code wait for each other.
      const [promo] = await tx
        .select()
        .from(schema.promoCode)
        .where(eq(schema.promoCode.code, code))
        .for("update");
      if (!promo) throw new RedeemError("Промокод не найден");

      const redeemed = await tx
        .insert(schema.promoRedemption)
        .values({ code, userId })
        .onConflictDoNothing()
        .returning();
      if (redeemed.length === 0) throw new RedeemError("Вы уже активировали этот промокод");
      if (promo.uses >= promo.maxUses) throw new RedeemError("Промокод закончился");

      await tx
        .update(schema.promoCode)
        .set({ uses: sql`${schema.promoCode.uses} + 1` })
        .where(eq(schema.promoCode.code, code));

      const [sub] = await tx
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.userId, userId))
        .for("update");
      const now = new Date();
      const active = isEntitled(sub, now);
      if (active && sub?.provider === "stripe") {
        throw new RedeemError("У вас уже есть подписка через Stripe — промокод можно активировать после её окончания");
      }

      const start = active && sub ? sub.currentPeriodEnd : now;
      const until = new Date(start.getTime() + promo.days * 24 * 60 * 60 * 1000);
      // An active YooKassa subscription keeps autopaying; the code just pushes the next charge back.
      const provider = active && sub?.provider === "yookassa" ? "yookassa" : "promo";
      await tx
        .insert(schema.subscription)
        .values({ userId, plan: "pro", provider, status: "active", currentPeriodEnd: until })
        .onConflictDoUpdate({
          target: schema.subscription.userId,
          set: {
            plan: "pro",
            provider,
            status: "active",
            currentPeriodEnd: until,
            // Promo periods don't renew, so there's nothing to cancel.
            ...(provider === "promo" ? { cancelAtPeriodEnd: false } : {}),
            updatedAt: now,
          },
        });
      return until;
    });
  } catch (err) {
    if (err instanceof RedeemError) return err.message;
    throw err;
  }
}
