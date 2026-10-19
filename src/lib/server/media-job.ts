// Starting a picture or clip that is already paid for. The studio (/api/generate)
// and the chat (a video answer) both go through here, so the gallery item, its
// charge and MARYX's fallback models work the same in both.

import { CAMERA_MOTIONS, IMAGE_STYLES, VIDEO_EFFECTS, withCameraMotion, withStyle, withVideoEffect } from "@/lib/effects";
import type { GenerateRequest, GenerateResult, MediaItem, ModelInfo } from "@/lib/types";
import type { SessionUser } from "./auth";
import { describeAiError } from "./brand";
import { characterPrompt, failureDetail, photoPrompt, recastPrompt, startWithFallback } from "./chat/image";
import type { StoredFile } from "./db/schema";
import { applyResult, createMedia, recordModel } from "./gallery";
import { motionPrompt } from "./media/higgsfield";
import { endUserId } from "./own-key";
import { deleteFiles, newKey, putFile } from "./storage";
import { checkRecast } from "./maryx";
import type { Meter } from "./spend";
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
  /** `stop`: when the request must have answered by (a recast's check and second try only run while they fit). */
  opts: { until: number; admin: boolean; stop?: number },
): Promise<MediaItem> {
  // A character's photos are already stored with the character (a recast keeps only the video's frame, a move-for-move trend nothing).
  const photos = req.recast ? (req.images ?? []).slice(0, 1) : req.character || req.motion ? [] : (req.images ?? []);
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
  // The model gets the full ask: the photo's instructions, the effect, the camera move or the style (the gallery keeps the user's words).
  const words = req.motion
    ? motionPrompt(req.castPlan)
    : req.recast
    ? recastPrompt(req.prompt, req.castPlan)
    : req.character
    ? characterPrompt(withStyle(req.prompt, IMAGE_STYLES.find((s) => s.id === req.style)))
    : photos.length
      ? photoPrompt(req.kind, req.prompt, photos.length)
      : withStyle(req.prompt, IMAGE_STYLES.find((s) => s.id === req.style));
  const filmed = withVideoEffect(words, VIDEO_EFFECTS.find((e) => e.id === req.effect));
  const ask = { ...req, prompt: withCameraMotion(filmed, CAMERA_MOTIONS.find((m) => m.id === req.camera)) };
  try {
    let attempt = await startWithFallback(ask, models, call, opts.until);
    // «Тренд»: a framed scene is checked before it's kept (a clip of a wrong frame wastes the most); one more try when it's wrong.
    const fits = (ms: number) => !opts.stop || Date.now() + ms < opts.stop;
    if (req.recast && attempt.error === undefined && attempt.result?.status === "succeeded" && fits(CHECK_MS)) {
      const meter = { userId: user.id, paidBy: paid.paidBy, key: paid.key };
      const verdict = await recastVerdict(req, attempt.result, meter);
      if (!verdict.ok) {
        const wrong = `Не получилось поставить героя в кадр${verdict.reason ? `: ${verdict.reason}` : ""}. Попробуйте другое фото — лицо крупно и хорошо освещено.`;
        let retry: typeof attempt | null = null;
        if (fits(PICTURE_MS + CHECK_MS)) {
          console.warn("[media] recast came out wrong, trying again:", verdict.reason);
          const others = models.filter((m) => m !== attempt.model);
          const again = { ...ask, prompt: `${ask.prompt} IMPORTANT: keep image 1 as the base picture — its place, framing and pose; only the face changes.` };
          retry = await startWithFallback(again, [...others, attempt.model], call, Date.now() + 20_000);
        }
        // The second take is kept when it passes (or when there's no time left to check it: the user sees it before any clip).
        const kept = retry?.error === undefined && retry?.result?.status === "succeeded" && (!fits(CHECK_MS) || (await recastVerdict(req, retry.result, meter)).ok);
        attempt = kept && retry ? retry : { model: attempt.model, result: { status: "failed", error: wrong } };
      }
    }
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

/** How long a recast's check (CHECK_MS) and one more picture (PICTURE_MS) may take, at most. */
const CHECK_MS = 20_000;
const PICTURE_MS = 45_000;

/** Whether a recast picture shows the video's scene with the new person (checked by MARYX); a URL result passes. */
async function recastVerdict(req: GenerateRequest, result: GenerateResult, meter: Meter): Promise<{ ok: boolean; reason: string }> {
  const output = result.status === "succeeded" ? result.outputs[0] : undefined;
  const [frame, ...references] = req.images ?? [];
  const reference = req.castPlan?.length ? req.images?.[req.castPlan[0].first - 1] : references[0];
  if (!output || output.type !== "base64" || !frame || !reference) return { ok: true, reason: "" };
  return checkRecast({ frame, result: { mime: output.mime, data: output.data }, reference }, meter);
}
