// Starting a picture or clip that is already paid for. The studio (/api/generate)
// and the chat (a video answer) both go through here, so the gallery item, its
// charge and MARYX's fallback models work the same in both.

import { CAMERA_MOTIONS, IMAGE_STYLES, withCameraMotion, withStyle } from "@/lib/effects";
import type { GenerateRequest, MediaItem, ModelInfo } from "@/lib/types";
import type { SessionUser } from "./auth";
import { describeAiError } from "./brand";
import { characterPrompt, failureDetail, photoPrompt, startWithFallback } from "./chat/image";
import type { StoredFile } from "./db/schema";
import { applyResult, createMedia, recordModel } from "./gallery";
import { endUserId } from "./own-key";
import { deleteFiles, newKey, putFile } from "./storage";
import { refundCharge, type Charge } from "./usage";

/**
 * Stores the user's photos next to the new gallery item, creates it and starts
 * `models` in turn (MARYX's next one when one refuses, until `until`). A
 * failure is recorded on the item, which gives the charge back; when the
 * photos can't be stored (no storage connected) this refunds and throws.
 */
export async function startMediaJob(
  user: SessionUser,
  req: GenerateRequest,
  paid: Charge,
  models: ModelInfo[],
  opts: { until: number; admin: boolean },
): Promise<MediaItem> {
  // A character's photos are already stored with the character.
  const photos = req.character ? [] : (req.images ?? []);
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
    throw err;
  }

  const call = { key: paid.key, endUser: endUserId(user.id) };
  const { admin } = opts;
  // The model gets the full ask: the photo's instructions, the camera move or the style (the gallery keeps the user's words).
  const words = req.character
    ? characterPrompt(withStyle(req.prompt, IMAGE_STYLES.find((s) => s.id === req.style)))
    : photos.length
      ? photoPrompt(req.kind, req.prompt, photos.length)
      : withStyle(req.prompt, IMAGE_STYLES.find((s) => s.id === req.style));
  const ask = { ...req, prompt: withCameraMotion(words, CAMERA_MOTIONS.find((m) => m.id === req.camera)) };
  try {
    const attempt = await startWithFallback(ask, models, call, opts.until);
    row = await recordModel(row, attempt.model.provider, attempt.model.id);
    if (attempt.error === undefined) return await applyResult(row, attempt.result!, call, { admin });
    const detail = failureDetail(attempt);
    console.error("[media]", detail);
    const error = describeAiError(attempt.error, attempt.model.provider, Boolean(paid.key));
    return await applyResult(row, { status: "failed", error }, call, { detail, admin });
  } catch (err) {
    console.error("[media]", req.provider, req.model, err);
    const error = describeAiError(err, req.provider, Boolean(paid.key));
    return await applyResult(row, { status: "failed", error }, call, { admin });
  }
}
