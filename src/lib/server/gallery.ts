import { and, desc, eq } from "drizzle-orm";
import type { GenerateRequest, GenerateResult, MediaItem, MediaKind } from "@/lib/types";
import type { SessionUser } from "./auth";
import { getDb, schema } from "./db";
import type { StoredFile } from "./db/schema";
import { describeError, statusOf } from "./errors";
import { checkGeneration, downloadOutput, type OpenRouterCall } from "./media";
import { endUserId, ownKey } from "./own-key";
import { mediaCost } from "./pricing";
import { deleteFiles, fileUrl, newKey, putFile } from "./storage";
import { settleCharge, today, type Charge } from "./usage";
import type { CostEntry } from "./spend";

type MediaRow = typeof schema.media.$inferSelect;

/** A start request that died (e.g. a crashed function) leaves no job id behind. */
const ORPHAN_AFTER_MS = 5 * 60 * 1000;
/** A job still not done after this long is given up on (the provider has lost it or keeps failing). */
const GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;

function toItem(row: MediaRow): MediaItem {
  return {
    id: row.id,
    kind: row.kind,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    aspectRatio: row.aspectRatio,
    status: row.status,
    progress: row.progress ?? undefined,
    error: row.error ?? undefined,
    files: row.files.map((f) => ({ url: fileUrl(f.key), mime: f.mime })),
    createdAt: row.createdAt.getTime(),
  };
}

export async function listMedia(userId: string, kind: MediaKind): Promise<MediaItem[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.userId, userId), eq(schema.media.kind, kind)))
    .orderBy(desc(schema.media.createdAt))
    .limit(200);
  return rows.map(toItem);
}

/**
 * How a gallery item is paid for. Items made before credits existed counted
 * toward the plan; they are booked as "pro" so they stay out of the site's
 * budget for free requests.
 */
function chargeOf(row: MediaRow): Charge {
  return {
    id: row.chargeId ?? row.id,
    userId: row.userId,
    kind: row.kind,
    paidBy: row.paidBy ?? "pro",
    held: row.heldCredits,
    day: row.chargeDay ?? today(),
  };
}

/** The estimated (or reported) cost of an item the provider made. */
function costOf(row: MediaRow, reported?: number): CostEntry {
  return {
    kind: row.kind,
    provider: row.provider,
    model: row.model,
    usd: reported ?? mediaCost(row.kind, row.model),
    estimated: reported === undefined,
  };
}

export async function createMedia(user: SessionUser, req: GenerateRequest, paid: Charge): Promise<MediaRow> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.media)
    .values({
      id: crypto.randomUUID(),
      userId: user.id,
      kind: req.kind,
      prompt: req.prompt,
      provider: req.provider,
      model: req.model,
      aspectRatio: req.aspectRatio,
      status: "pending",
      paidBy: paid.paidBy,
      heldCredits: paid.held,
      chargeId: paid.id,
      chargeDay: paid.day,
    })
    .returning();
  return row;
}

async function update(row: MediaRow, changes: Partial<MediaRow>): Promise<MediaRow> {
  const db = await getDb();
  const [next] = await db
    .update(schema.media)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(schema.media.id, row.id))
    .returning();
  return next ?? row;
}

/**
 * Marks a pending item failed and gives its charge back — once, however many
 * polls get here. `costs`: what the provider billed anyway (it made the
 * result, but it couldn't be stored).
 */
async function fail(row: MediaRow, error: string, costs: CostEntry[] = []): Promise<MediaRow> {
  const db = await getDb();
  const [failed] = await db
    .update(schema.media)
    .set({ status: "failed", error, progress: null, updatedAt: new Date() })
    .where(and(eq(schema.media.id, row.id), eq(schema.media.status, "pending")))
    .returning();
  if (!failed) {
    const [current] = await db.select().from(schema.media).where(eq(schema.media.id, row.id));
    return current ?? row;
  }
  await settleCharge(chargeOf(row), costs, true);
  return failed;
}

/**
 * Records a provider result; finished outputs are copied into our storage and
 * the cost is recorded. `call` carries the user's own OpenRouter key when the
 * item is paid with it (needed to download OpenRouter videos).
 */
export async function applyResult(row: MediaRow, result: GenerateResult, call: OpenRouterCall = {}): Promise<MediaItem> {
  if (result.status === "pending") {
    return toItem(await update(row, { jobId: result.jobId, progress: result.progress ?? null }));
  }
  if (result.status === "failed") return toItem(await fail(row, result.error));

  const files: StoredFile[] = [];
  try {
    for (const output of result.outputs) {
      const { body, mime } = await downloadOutput(row.provider, output, row.kind, call.key);
      const key = newKey(row.userId, "media", mime);
      await putFile(key, body, mime);
      files.push({ key, mime });
    }
  } catch (err) {
    await deleteFiles(files.map((f) => f.key)).catch(() => {});
    // The provider made (and billed) it; only the copy failed.
    return toItem(await fail(row, describeError(err), [costOf(row, result.cost)]));
  }

  // Two polls can finish the same job at once; only the first one keeps its files.
  const db = await getDb();
  const [saved] = await db
    .update(schema.media)
    .set({ status: "succeeded", files, progress: null, updatedAt: new Date() })
    .where(and(eq(schema.media.id, row.id), eq(schema.media.status, "pending")))
    .returning();
  if (!saved) {
    await deleteFiles(files.map((f) => f.key)).catch(() => {});
    const [current] = await db.select().from(schema.media).where(eq(schema.media.id, row.id));
    return toItem(current ?? row);
  }
  await settleCharge(chargeOf(row), [costOf(row, result.cost)]);
  return toItem(saved);
}

/** Current state of an item, checking the provider if the job is still running. */
export async function refreshMedia(userId: string, id: string): Promise<MediaItem | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, id), eq(schema.media.userId, userId)));
  if (!row) return null;
  if (row.status !== "pending") return toItem(row);

  if (!row.jobId) {
    const stale = Date.now() - row.createdAt.getTime() > ORPHAN_AFTER_MS;
    return toItem(stale ? await fail(row, "Генерация прервалась. Попробуйте ещё раз.") : row);
  }
  // A video paid with the user's own key is checked and downloaded with it.
  const key = row.paidBy === "byok" ? await ownKey(userId) : undefined;
  if (row.paidBy === "byok" && !key) {
    return toItem(await fail(row, "Ваш ключ OpenRouter удалён из настроек — узнать, готово ли видео, больше нельзя."));
  }
  // Still not done (or not answering) after hours: give up. The provider may have billed it,
  // so the estimate stays in the ledger, and the user gets the use back.
  const tooOld = Date.now() - row.createdAt.getTime() > GIVE_UP_AFTER_MS;
  const giveUp = async () =>
    toItem(await fail(row, "Видео так и не было готово. Попробуйте ещё раз.", row.paidBy === "byok" ? [] : [costOf(row)]));
  const call = { key, endUser: endUserId(userId) };
  try {
    const result = await checkGeneration(row.provider, row.kind, row.jobId, call);
    if (result.status === "pending" && tooOld) return await giveUp();
    return await applyResult(row, result, call);
  } catch (err) {
    // With the user's own key, a rejected key or a job that belongs to another
    // account won't get better: stop polling.
    const status = statusOf(err);
    if (row.paidBy === "byok" && (status === 401 || status === 403 || status === 404)) {
      return toItem(await fail(row, describeError(err, row.provider, true)));
    }
    if (tooOld) return giveUp();
    // Transient provider/network errors: keep the job and let the next poll retry.
    console.error("[media] status check failed", row.provider, row.jobId, err);
    return toItem(row);
  }
}

export async function deleteMedia(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  // A job still running goes on at the provider, which bills it: book its estimated cost.
  const [abandoned] = await db
    .update(schema.media)
    .set({ status: "failed", error: "Удалено", updatedAt: new Date() })
    .where(and(eq(schema.media.id, id), eq(schema.media.userId, userId), eq(schema.media.status, "pending")))
    .returning();
  if (abandoned) await settleCharge(chargeOf(abandoned), abandoned.paidBy === "byok" ? [] : [costOf(abandoned)]);
  const [row] = await db
    .delete(schema.media)
    .where(and(eq(schema.media.id, id), eq(schema.media.userId, userId)))
    .returning();
  if (!row) return false;
  await deleteFiles(row.files.map((f) => f.key)).catch((e) =>
    console.error("[media] failed to delete files", e),
  );
  return true;
}
