// «Мой персонаж»: a person (the user, a friend) saved once as 1–3 photos, then
// drawn by MARYX in any scene. The photos stay private: they're read by the
// owner through /api/files and sent to the image model as references.

import { and, asc, count, eq } from "drizzle-orm";
import type { Character, InlineImage } from "@/lib/types";
import { getDb, schema } from "./db";
import type { StoredFile } from "./db/schema";
import { isValidId } from "./http";
import { deleteFiles, fileUrl, newKey, putFile, readFileBase64 } from "./storage";

/** Characters one user can keep. */
export const MAX_CHARACTERS = 8;
/** Photos of one character: a few angles are enough for the face. */
export const MAX_CHARACTER_PHOTOS = 3;

type CharacterRow = typeof schema.character.$inferSelect;

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    name: row.name,
    photos: row.photos.map((f) => ({ url: fileUrl(f.key), mime: f.mime })),
    createdAt: row.createdAt.getTime(),
  };
}

export async function listCharacters(userId: string): Promise<Character[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.character)
    .where(eq(schema.character.userId, userId))
    .orderBy(asc(schema.character.createdAt));
  return rows.map(toCharacter);
}

/** Stores the photos and the character, or returns why it can't (too many characters). */
export async function createCharacter(userId: string, name: string, photos: InlineImage[]): Promise<Character | string> {
  const db = await getDb();
  const [{ kept }] = await db.select({ kept: count() }).from(schema.character).where(eq(schema.character.userId, userId));
  if (kept >= MAX_CHARACTERS) return `Можно сохранить до ${MAX_CHARACTERS} персонажей — удалите ненужного.`;
  const stored: StoredFile[] = [];
  try {
    for (const photo of photos) {
      const key = newKey(userId, "characters", photo.mime);
      await putFile(key, Buffer.from(photo.data, "base64"), photo.mime);
      stored.push({ key, mime: photo.mime });
    }
    const [row] = await db
      .insert(schema.character)
      .values({ id: crypto.randomUUID(), userId, name, photos: stored })
      .returning();
    return toCharacter(row);
  } catch (err) {
    await deleteFiles(stored.map((f) => f.key)).catch(() => {});
    throw err;
  }
}

export async function deleteCharacter(userId: string, id: string): Promise<boolean> {
  if (!isValidId(id)) return false;
  const db = await getDb();
  const [row] = await db
    .delete(schema.character)
    .where(and(eq(schema.character.id, id), eq(schema.character.userId, userId)))
    .returning();
  if (!row) return false;
  await deleteFiles(row.photos.map((f) => f.key)).catch((e) => console.error("[character] failed to delete files", e));
  return true;
}

/** A character's photos, read back to go to the image model; null when it's not this user's (or gone). */
export async function characterPhotos(userId: string, id: string): Promise<InlineImage[] | null> {
  if (!isValidId(id)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.character)
    .where(and(eq(schema.character.id, id), eq(schema.character.userId, userId)));
  if (!row) return null;
  const photos = await Promise.all(
    row.photos.map(async (f) => {
      const data = await readFileBase64(f.key);
      return data ? { mime: f.mime, data } : null;
    }),
  );
  const found = photos.filter((p) => p !== null);
  return found.length ? found : null;
}
