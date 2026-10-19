import { isAdmin } from "@/lib/server/auth";
import { describeAiError, maryxOnly } from "@/lib/server/brand";
import { characterPhotos } from "@/lib/server/characters";
import { maryxMediaModel, maryxMediaModels } from "@/lib/server/chat/image";
import { StorageUnavailableError } from "@/lib/server/errors";
import { jsonError, requireUser, storageUnavailable } from "@/lib/server/http";
import { startMediaJob } from "@/lib/server/media-job";
import { listModels } from "@/lib/server/models";
import { ownKey, ownKeyInfo } from "@/lib/server/own-key";
import { mediaCost } from "@/lib/server/pricing";
import { charge, deniedResponse, refundCharge, reserve } from "@/lib/server/usage";
import { parseGenerateRequest } from "@/lib/server/validate";
import type { ModelInfo } from "@/lib/types";

export const maxDuration = 120;

/** MARYX starts another model after a refusal only this soon, so the picture still fits in maxDuration. */
const FALLBACK_WINDOW_MS = 45_000;
const NO_TRANSITION = "Видео с последним кадром пока не подключено — оставьте одно фото.";

/**
 * Starts an image or video generation and returns the gallery item. Images
 * usually come back finished; videos come back "pending" and the browser
 * polls /api/media/[id] until they're done. With `images`, the user's photos
 * are edited instead (stored next to the result); with `character`, the
 * character's photos show the model who to draw.
 */
export async function POST(request: Request) {
  const started = Date.now();
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const parsed = parseGenerateRequest(await request.json().catch(() => null));
  if (typeof parsed === "string") return jsonError(parsed, 400);
  let req = parsed;
  // «Мой персонаж»: the character's photos go to the model as references (models that take photos only).
  // A recast of several people: the frame first, then each one's pictures (a saved character's, or their photo).
  if (req.cast) {
    const [frame, ...uploaded] = req.images ?? [];
    const images = [frame];
    const castPlan: NonNullable<typeof req.castPlan> = [];
    for (const role of req.cast) {
      let refs = role.character ? await characterPhotos(user.id, role.character) : uploaded.splice(0, 1);
      if (!refs?.length) return jsonError("Персонаж не найден — добавьте его заново.", 404);
      // With several people, one picture each keeps the ask within what image models take.
      refs = refs.slice(0, req.cast.length > 1 ? 1 : 3);
      castPlan.push({ who: role.who, first: images.length + 1, count: refs.length });
      images.push(...refs);
    }
    req = { ...req, images, castPlan };
  }
  if (req.character) {
    const references = await characterPhotos(user.id, req.character);
    if (!references) return jsonError("Персонаж не найден — добавьте его заново.", 404);
    // A recast keeps the video's frame first: the character takes the main person's place in it.
    req = { ...req, images: req.recast ? [...(req.images ?? []), ...references] : references };
  }
  const photos = req.images ?? [];
  // Video with two photos: a clip from the first to the second.
  const transition = req.kind === "video" && photos.length === 2;

  // OpenRouter models (and MARYX, which picks them) go out with the user's own key when they saved one.
  const key = req.provider === "openrouter" || req.provider === "maryx" ? await ownKey(user.id) : undefined;
  // MARYX picks the real model itself (and the next ones, should it refuse); the gallery shows it as MARYX's.
  let models: ModelInfo[];
  if (req.provider === "maryx") {
    try {
      // Says what to set up when there's no model for it.
      const first = await maryxMediaModel(req.kind, key !== undefined, photos.length > 0);
      models = await maryxMediaModels(req.kind, key !== undefined, photos.length > 0);
      // A transition between two frames: only models that end on a given picture.
      if (transition) {
        models = models.filter((m) => m.lastFrame);
        if (!models.length) return jsonError(NO_TRANSITION, 400);
      }
      req = { ...req, provider: (models[0] ?? first).provider, model: (models[0] ?? first).id };
    } catch (err) {
      return jsonError(
        photos.length && maryxOnly()
          ? `MARYX пока не умеет ${req.kind === "image" ? "обрабатывать" : "оживлять"} фото — попробуйте позже.`
          : describeAiError(err),
        503,
      );
    }
  } else {
    if (photos.length) {
      const { models: offered } = await listModels(req.kind, { ownKey: key !== undefined });
      const chosen = offered.find((m) => m.provider === req.provider && m.id === req.model && m.photoEdit);
      if (!chosen) {
        return jsonError(`Эта модель не умеет ${req.kind === "image" ? "обрабатывать" : "оживлять"} фото — выберите другую.`, 400);
      }
      if (transition && !chosen.lastFrame) return jsonError(NO_TRANSITION, 400);
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

  try {
    return Response.json(
      await startMediaJob(user, req, paid, models, { until: started + FALLBACK_WINDOW_MS, admin: isAdmin(user) }),
    );
  } catch (err) {
    if (err instanceof StorageUnavailableError) return storageUnavailable(user, err.message);
    throw err;
  }
}
