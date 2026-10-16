import { randomInt } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { PromoCode } from "@/lib/types";
import { getDb, schema } from "../db";
import { grantCredits } from "./credits";
import { hasLiveStripe, isEntitled } from "./plans";

const CODE_PATTERN = /^[A-Z0-9-]{4,40}$/;
// No 0/O, 1/I/L: codes are typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function randomCode(): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `MARYX-${part()}-${part()}`;
}

function toPromo(row: typeof schema.promoCode.$inferSelect): PromoCode {
  return {
    code: row.code,
    days: row.days,
    credits: row.credits,
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
  credits?: number;
  maxUses: number;
  note?: string;
}): Promise<PromoCode | string> {
  const code = input.code ? normalizeCode(input.code) : randomCode();
  const credits = input.credits ?? 0;
  if (!CODE_PATTERN.test(code)) return "Код: 4–40 символов, латиница, цифры и дефис";
  if (!Number.isInteger(input.days) || input.days < 0 || input.days > 3650) return "Дней Pro: от 0 до 3650";
  if (!Number.isInteger(credits) || credits < 0 || credits > 1_000_000) return "Кредитов: от 0 до 1 000 000";
  if (input.days === 0 && credits === 0) return "Код должен давать дни Pro, кредиты или и то и другое";
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 100_000) {
    return "Активаций: от 1 до 100 000";
  }
  const db = await getDb();
  const rows = await db
    .insert(schema.promoCode)
    .values({ code, days: input.days, credits, maxUses: input.maxUses, note: input.note?.slice(0, 200) || null })
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

/**
 * Grants the code's days of Pro and/or credits. Returns the new end of the
 * paid period (if the code gives days) and the credits added, or an error message.
 */
export async function redeemPromo(userId: string, rawCode: string): Promise<{ until?: Date; credits: number } | string> {
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

      if (promo.credits > 0) {
        // Per code instance: a code deleted and created again under the same name gives its credits again.
        const granted = await grantCredits(
          { id: `promo:${code}:${promo.createdAt.getTime()}:${userId}`, userId, credits: promo.credits, source: "promo", note: code },
          tx,
        );
        if (!granted) throw new RedeemError("Вы уже получили кредиты по этому промокоду");
      }
      if (promo.days <= 0) return { credits: promo.credits };

      const [sub] = await tx
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.userId, userId))
        .for("update");
      const now = new Date();
      const active = isEntitled(sub, now);
      if (hasLiveStripe(sub)) {
        throw new RedeemError("У вас есть подписка через Stripe — промокод можно активировать после её окончания");
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
            // The period now ends on another day of the month; the next
            // YooKassa renewal re-anchors on it instead of cutting the month short.
            anchorDay: null,
            // Promo periods don't renew, so there's nothing to cancel; a finished
            // Stripe subscription is no longer ours to track.
            ...(provider === "promo" ? { cancelAtPeriodEnd: false, stripeSubscriptionId: null } : {}),
            updatedAt: now,
          },
        });
      return { until, credits: promo.credits };
    });
  } catch (err) {
    if (err instanceof RedeemError) return err.message;
    throw err;
  }
}
