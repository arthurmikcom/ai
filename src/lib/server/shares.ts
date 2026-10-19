// Pages made in the chat (games, sites) shared by a public link. Anyone with the
// link sees the page; it runs in an isolated frame, like in the chat.

import { and, count, eq, gt } from "drizzle-orm";
import { getDb, schema } from "./db";

/** A page's size limit (a whole game fits in far less). */
export const MAX_SHARE_CHARS = 600_000;
/** Shares one user can make a day: plenty for people, a wall for a script. */
const SHARES_PER_DAY = 100;
const ID = /^[A-Za-z0-9_-]{16}$/;

export function isShareId(id: string): boolean {
  return ID.test(id);
}

/** Stores a page and returns its id, or null when today's limit is reached. */
export async function createShare(userId: string, title: string, html: string): Promise<string | null> {
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ made }] = await db
    .select({ made: count() })
    .from(schema.share)
    .where(and(eq(schema.share.userId, userId), gt(schema.share.createdAt, since)));
  if (made >= SHARES_PER_DAY) return null;
  // 96 random bits: links can't be guessed.
  const id = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url");
  await db.insert(schema.share).values({ id, userId, title, html });
  return id;
}

export async function getShare(id: string): Promise<{ title: string; html: string } | null> {
  if (!isShareId(id)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ title: schema.share.title, html: schema.share.html })
    .from(schema.share)
    .where(eq(schema.share.id, id));
  return row ?? null;
}
