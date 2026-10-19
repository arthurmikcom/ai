import { isAdmin } from "@/lib/server/auth";
import { describeAiError, maryxOnly } from "@/lib/server/brand";
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
        photos.length && maryxOnly()
          ? `MARYX пока не умеет ${req.kind === "image" ? "обрабатывать" : "оживлять"} фото — попробуйте позже.`
          : describeAiError(err),
        503,
      );
    }
  } else {
    if (photos.length) {
      const { models: offered } = await listModels(req.kind, { ownKey: key !== undefined });
      if (!offered.some((m) => m.provider === req.provider && m.id === req.model && m.photoEdit)) {
        return jsonError(`Эта модель не умеет ${req.kind === "image" ? "обрабатывать" : "оживлять"} фото — выберите другую.`, 400);
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

  try {
    return Response.json(
      await startMediaJob(user, req, paid, models, { until: started + FALLBACK_WINDOW_MS, admin: isAdmin(user) }),
    );
  } catch (err) {
    if (err instanceof StorageUnavailableError) return storageUnavailable(user, err.message);
    throw err;
  }
}
