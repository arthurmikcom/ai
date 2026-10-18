import { and, desc, eq } from "drizzle-orm";
import type { GenerateRequest, GenerateResult, MediaItem, MediaKind } from "@/lib/types";
import type { SessionUser } from "./auth";
import { getDb, schema } from "./db";
import type { StoredFile } from "./db/schema";
import { describeAiError, maryxOnly, publicError } from "./brand";
import { statusOf } from "./errors";
import { checkGeneration, downloadOutput, type OpenRouterCall } from "./media";
import { endUserId, savedOwnKey } from "./own-key";
import { mediaCost } from "./pricing";
import { deleteFiles, fileUrl, newKey, putFile } from "./storage";
import { settleCharge, today, type Charge } from "./usage";
import type { CostEntry } from "./spend";

type MediaRow = typeof schema.media.$inferSelect;

/** A start request that died (e.g. a crashed function) leaves no job id behind. */
const ORPHAN_AFTER_MS = 5 * 60 * 1000;
/** A job still not done after this long is given up on (the provider has lost it or keeps failing). */
const GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * A gallery item as the browser sees it: in MARYX-only mode, MARYX's (the
 * real model stays stored for polling and costs). Admins also see the
 * provider's own reason for a failure.
 */
function toItem(row: MediaRow, admin = false): MediaItem {
  const masked = maryxOnly();
  const error = row.error ? publicError(row.error) : undefined;
  return {
    id: row.id,
    kind: row.kind,
    prompt: row.prompt,
    provider: masked ? "maryx" : row.provider,
    model: masked ? `maryx-${row.kind}` : row.model,
    aspectRatio: row.aspectRatio,
    status: row.status,
    progress: row.progress ?? undefined,
    error: error && admin && row.errorDetail ? `${error} [для администратора: ${row.errorDetail}]` : error,
    files: row.files.map((f) => ({ url: fileUrl(f.key), mime: f.mime })),
    ...(row.inputs?.length ? { inputs: row.inputs.map((f) => ({ url: fileUrl(f.key), mime: f.mime })) } : {}),
    createdAt: row.createdAt.getTime(),
  };
}

export async function listMedia(userId: string, kind: MediaKind, admin = false): Promise<MediaItem[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.userId, userId), eq(schema.media.kind, kind)))
    .orderBy(desc(schema.media.createdAt))
    .limit(200);
  return rows.map((row) => toItem(row, admin));
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

/** `inputs`: the user's photos it is made from, already stored. */
export async function createMedia(user: SessionUser, req: GenerateRequest, paid: Charge, inputs?: StoredFile[]): Promise<MediaRow> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.media)
    .values({
      id: crypto.randomUUID(),
      userId: user.id,
      kind: req.kind,
      prompt: req.prompt || (inputs?.length ? "Естественная ретушь фото" : req.prompt),
      inputs: inputs?.length ? inputs : null,
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

/** The model that took the job, when MARYX's first choice refused it and another one tried. */
export async function recordModel(row: MediaRow, provider: MediaRow["provider"], model: string): Promise<MediaRow> {
  if (row.provider === provider && row.model === model) return row;
  return update(row, { provider, model });
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
 * result, but it couldn't be stored). `detail`: the provider's own reason, for admins.
 */
async function fail(row: MediaRow, error: string, costs: CostEntry[] = [], detail?: string): Promise<MediaRow> {
  const db = await getDb();
  const [failed] = await db
    .update(schema.media)
    .set({ status: "failed", error, errorDetail: detail?.slice(0, 1000) ?? null, progress: null, updatedAt: new Date() })
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
 * item is paid with it (needed to download OpenRouter videos). `opts.detail`:
 * the provider's own reason for a failure; `opts.admin`: the viewer sees it.
 */
export async function applyResult(
  row: MediaRow,
  result: GenerateResult,
  call: OpenRouterCall = {},
  opts: { detail?: string; admin?: boolean } = {},
): Promise<MediaItem> {
  const item = (r: MediaRow) => toItem(r, opts.admin);
  if (result.status === "pending") {
    return item(await update(row, { jobId: result.jobId, progress: result.progress ?? null }));
  }
  if (result.status === "failed") return item(await fail(row, result.error, [], opts.detail ?? result.error));

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
    return item(await fail(row, describeAiError(err), [costOf(row, result.cost)], err instanceof Error ? err.message : String(err)));
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
    return item(current ?? row);
  }
  await settleCharge(chargeOf(row), [costOf(row, result.cost)]);
  return item(saved);
}

/** Current state of an item, checking the provider if the job is still running. */
export async function refreshMedia(userId: string, id: string, admin = false): Promise<MediaItem | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, id), eq(schema.media.userId, userId)));
  if (!row) return null;
  if (row.status !== "pending") return toItem(row, admin);

  if (!row.jobId) {
    const stale = Date.now() - row.createdAt.getTime() > ORPHAN_AFTER_MS;
    return toItem(stale ? await fail(row, "Генерация прервалась. Попробуйте ещё раз.") : row, admin);
  }
  // A video paid with the user's own key is checked and downloaded with it (also once own keys are off).
  const key = row.paidBy === "byok" ? await savedOwnKey(userId) : undefined;
  if (row.paidBy === "byok" && !key) {
    return toItem(await fail(row, `Ваш ключ${maryxOnly() ? "" : " OpenRouter"} удалён из настроек — узнать, готово ли видео, больше нельзя.`), admin);
  }
  // Still not done (or not answering) after hours: give up. The provider may have billed it,
  // so the estimate stays in the ledger, and the user gets the use back.
  const tooOld = Date.now() - row.createdAt.getTime() > GIVE_UP_AFTER_MS;
  const giveUp = async () =>
    toItem(await fail(row, "Видео так и не было готово. Попробуйте ещё раз.", row.paidBy === "byok" ? [] : [costOf(row)]), admin);
  const call = { key, endUser: endUserId(userId) };
  try {
    const result = await checkGeneration(row.provider, row.kind, row.jobId, call);
    if (result.status === "pending" && tooOld) return await giveUp();
    return await applyResult(row, result, call, { admin });
  } catch (err) {
    // With the user's own key, a rejected key or a job that belongs to another
    // account won't get better: stop polling.
    const status = statusOf(err);
    if (row.paidBy === "byok" && (status === 401 || status === 403 || status === 404)) {
      return toItem(await fail(row, describeAiError(err, row.provider, true)), admin);
    }
    if (tooOld) return giveUp();
    // Transient provider/network errors: keep the job and let the next poll retry.
    console.error("[media] status check failed", row.provider, row.jobId, err);
    return toItem(row, admin);
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
  await deleteFiles([...row.files, ...(row.inputs ?? [])].map((f) => f.key)).catch((e) =>
    console.error("[media] failed to delete files", e),
  );
  return true;
}
