import { and, eq, gt, inArray, lt, notExists, or } from "drizzle-orm";
import { getDb, schema, type DB } from "./db";

// Guests chat without an account, like on ChatGPT: the first visit to the chat
// signs them in as an anonymous user (better-auth's anonymous plugin), kept
// only by the browser's cookie. They can only chat — no files, pictures or
// video — so nothing of theirs is in storage.

/**
 * A guest signed up or signed in: their chats (and what MARYX remembered from
 * them) go to the account. The anonymous user is deleted right after, with
 * the rest (sessions, today's counters).
 */
export async function moveGuestData(db: DB, from: string, to: string): Promise<void> {
  if (from === to) return;
  await db.update(schema.chat).set({ userId: to }).where(eq(schema.chat.userId, from));
  await db.update(schema.memory).set({ userId: to }).where(eq(schema.memory.userId, from));
}

/**
 * Removes guests nobody can come back as: every session of theirs has expired
 * (the cookie was their only key), or they never chatted and haven't been
 * seen for a day. Their AI costs stay in the ledger (without the user).
 */
export async function purgeGuests(): Promise<number> {
  const db = await getDb();
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const { user, session, chat } = schema;
  const live = db.select({ id: session.id }).from(session).where(and(eq(session.userId, user.id), gt(session.expiresAt, new Date())));
  const seen = db.select({ id: session.id }).from(session).where(and(eq(session.userId, user.id), gt(session.updatedAt, dayAgo)));
  const chatted = db.select({ id: chat.id }).from(chat).where(eq(chat.userId, user.id));
  const stale = db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.isAnonymous, true), lt(user.createdAt, dayAgo), or(notExists(live), and(notExists(chatted), notExists(seen)))))
    .limit(1000);
  // In batches, so a busy day's guests don't make one huge delete.
  let total = 0;
  for (let batch = 0; batch < 20; batch++) {
    const gone = await db.delete(user).where(inArray(user.id, stale)).returning({ id: user.id });
    total += gone.length;
    if (gone.length < 1000) break;
  }
  return total;
}
