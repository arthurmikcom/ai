import { isAdmin } from "@/lib/server/auth";
import { describeAiError, maryxOnly } from "@/lib/server/brand";
import { editPrompt, failureDetail, maryxMediaModel, maryxMediaModels, startWithFallback } from "@/lib/server/chat/image";
import type { StoredFile } from "@/lib/server/db/schema";
import { StorageUnavailableError } from "@/lib/server/errors";
import { applyResult, createMedia, recordModel } from "@/lib/server/gallery";
import { jsonError, requireUser, storageUnavailable } from "@/lib/server/http";
import { listModels } from "@/lib/server/models";
import { endUserId, ownKey, ownKeyInfo } from "@/lib/server/own-key";
import { mediaCost } from "@/lib/server/pricing";
import { deleteFiles, newKey, putFile } from "@/lib/server/storage";
import { charge, deniedResponse, refundCharge, reserve } from "@/lib/server/usage";
import { parseGenerateRequest } from "@/lib/server/validate";
import type { ModelInfo } from "@/lib/types";

export const maxDuration = 120;

/** MARYX starts another model after a refusal only this soon, so the picture still fits in maxDuration. */
const FALLBACK_WINDOW_MS = 45_000;

/**
 * Starts an image or video generation and returns the gallery item. Images
 * usually come back finished; videos come back "pending" and the browser
 * polls /api/media/[id] until they're done. With `images`, the user's photos
 * are edited instead (stored next to the result).
 */
export async function POST(request: Request) {
  const started = Date.now();
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const parsed = parseGenerateRequest(await request.json().catch(() => null));
  if (typeof parsed === "string") return jsonError(parsed, 400);
  let req = parsed;
  const photos = req.images ?? [];

  // OpenRouter models (and MARYX, which picks them) go out with the user's own key when they saved one.
  const key = req.provider === "openrouter" || req.provider === "maryx" ? await ownKey(user.id) : undefined;
  // MARYX picks the real model itself (and the next ones, should it refuse); the gallery shows it as MARYX's.
  let models: ModelInfo[];
  if (req.provider === "maryx") {
    try {
      // Says what to set up when there's no model for it.
      const first = await maryxMediaModel(req.kind, key !== undefined, photos.length > 0);
      models = await maryxMediaModels(req.kind, key !== undefined, photos.length > 0);
      req = { ...req, provider: first.provider, model: first.id };
    } catch (err) {
      return jsonError(
        photos.length && maryxOnly() ? "MARYX пока не умеет обрабатывать фото — попробуйте позже." : describeAiError(err),
        503,
      );
    }
  } else {
    if (photos.length) {
      const { models: offered } = await listModels("image", { ownKey: key !== undefined });
      if (!offered.some((m) => m.provider === req.provider && m.id === req.model && m.photoEdit)) {
        return jsonError("Эта модель не умеет обрабатывать фото — выберите другую.", 400);
      }
    }
    models = [{ provider: req.provider, id: req.model, label: req.model, capability: req.kind, featured: false }];
  }

  const hasKey = async () => key !== undefined || Boolean(await ownKeyInfo(user.id));
  const paid = await charge(user, req.kind, key);
  if ("denied" in paid) return deniedResponse(user, req.kind, paid.denied, { ownKey: await hasKey() });
  // Its price is known up front: held against the budgets and credits until it's done.
  let refused;
  try {
    refused = await reserve(paid, mediaCost(req.kind, req.model, req.duration), req);
  } catch (err) {
    await refundCharge(paid);
    throw err;
  }
  if (refused) {
    await refundCharge(paid);
    return deniedResponse(user, req.kind, refused, { ownKey: await hasKey(), charge: paid });
  }

  // The photos are kept with the item (shown as its source, deleted with it).
  const inputs: StoredFile[] = [];
  let row;
  try {
    for (const photo of photos) {
      const fileKey = newKey(user.id, "attachments", photo.mime);
      await putFile(fileKey, Buffer.from(photo.data, "base64"), photo.mime);
      inputs.push({ key: fileKey, mime: photo.mime });
    }
    row = await createMedia(user, req, paid, inputs);
  } catch (err) {
    await deleteFiles(inputs.map((f) => f.key)).catch(() => {});
    await refundCharge(paid);
    if (err instanceof StorageUnavailableError) return storageUnavailable(user, err.message);
    throw err;
  }

  const call = { key: paid.key, endUser: endUserId(user.id) };
  const admin = isAdmin(user);
  const ask = photos.length ? { ...req, prompt: editPrompt(req.prompt) } : req;
  try {
    const attempt = await startWithFallback(ask, models, call, started + FALLBACK_WINDOW_MS);
    row = await recordModel(row, attempt.model.provider, attempt.model.id);
    if (attempt.error === undefined) return Response.json(await applyResult(row, attempt.result!, call, { admin }));
    const detail = failureDetail(attempt);
    console.error("[generate]", detail);
    const error = describeAiError(attempt.error, attempt.model.provider, Boolean(paid.key));
    return Response.json(await applyResult(row, { status: "failed", error }, call, { detail, admin }));
  } catch (err) {
    console.error("[generate]", req.provider, req.model, err);
    const error = describeAiError(err, req.provider, Boolean(paid.key));
    return Response.json(await applyResult(row, { status: "failed", error }, call, { admin }));
  }
}
