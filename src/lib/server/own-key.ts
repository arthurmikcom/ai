// BYOK — "bring your own key": a user saves their own OpenRouter key, and
// their OpenRouter requests (chat, MARYX, pictures, video, dictation) go out
// with it. They pay OpenRouter themselves, so the plan's limits don't apply.
// The key is kept encrypted with a key derived from the server's secret and
// is never sent back to the browser.

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { serverSecret } from "./auth";
import { openRouterBase } from "./config";
import { getDb, schema } from "./db";

async function cipherKey(): Promise<Buffer> {
  const secret = await serverSecret();
  return Buffer.from(hkdfSync("sha256", secret, "maryx-own-key", "openrouter-v1", 32));
}

async function encrypt(plain: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await cipherKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

async function decrypt(sealed: string): Promise<string | null> {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", await cipherKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // The server secret changed since the key was saved: the user has to enter it again.
    return null;
  }
}

/** OpenRouter keys look like sk-or-v1-<64 hex>; anything close enough is checked with OpenRouter. */
const KEY_PATTERN = /^sk-or-[A-Za-z0-9_-]{20,200}$/;

/** The user's own OpenRouter key, or undefined. */
export async function ownKey(userId: string): Promise<string | undefined> {
  const db = await getDb();
  const [row] = await db.select({ secret: schema.userKey.secret }).from(schema.userKey).where(eq(schema.userKey.userId, userId));
  return row ? ((await decrypt(row.secret)) ?? undefined) : undefined;
}

/** What the settings page shows about a saved key. */
export async function ownKeyInfo(userId: string): Promise<{ hint: string } | null> {
  const db = await getDb();
  const [row] = await db
    .select({ hint: schema.userKey.hint, secret: schema.userKey.secret })
    .from(schema.userKey)
    .where(eq(schema.userKey.userId, userId));
  if (!row) return null;
  // A key that can't be read any more isn't used either, so don't show it as working.
  return (await decrypt(row.secret)) === null ? null : { hint: row.hint };
}

/**
 * Checks a key with OpenRouter and saves it. Returns an error message for the
 * user, or null when it was saved.
 */
export async function saveOwnKey(userId: string, raw: string): Promise<string | null> {
  const key = raw.trim();
  if (!KEY_PATTERN.test(key)) return "Это не похоже на ключ OpenRouter: он начинается с sk-or-";
  let res: Response;
  try {
    res = await fetch(`${openRouterBase()}/key`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return "Не удалось связаться с OpenRouter, чтобы проверить ключ. Попробуйте ещё раз.";
  }
  if (res.status === 401 || res.status === 403) return "OpenRouter не принял этот ключ: проверьте, что он скопирован целиком и не удалён.";
  if (!res.ok) return `OpenRouter не смог проверить ключ (HTTP ${res.status}). Попробуйте позже.`;

  const db = await getDb();
  const values = { secret: await encrypt(key), hint: `…${key.slice(-4)}`, createdAt: new Date() };
  await db
    .insert(schema.userKey)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.userKey.userId, set: values });
  return null;
}

export async function deleteOwnKey(userId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.userKey).where(eq(schema.userKey.userId, userId));
}

/**
 * A stable pseudonym for a user, sent to OpenRouter as `user`: a policy block
 * caused by one person then stays on them instead of the whole account.
 */
export function endUserId(userId: string): string {
  return createHash("sha256").update(`maryx:${userId}`).digest("hex").slice(0, 32);
}
