import { describeAiError } from "@/lib/server/brand";
import { maryxMediaModel } from "@/lib/server/chat/image";
import { applyResult, createMedia } from "@/lib/server/gallery";
import { jsonError, requireUser } from "@/lib/server/http";
import { startGeneration } from "@/lib/server/media";
import { endUserId, ownKey, ownKeyInfo } from "@/lib/server/own-key";
import { mediaCost } from "@/lib/server/pricing";
import { charge, deniedResponse, refundCharge, reserve } from "@/lib/server/usage";
import { parseGenerateRequest } from "@/lib/server/validate";

export const maxDuration = 120;

/**
 * Starts an image or video generation and returns the gallery item. Images
 * usually come back finished; videos come back "pending" and the browser
 * polls /api/media/[id] until they're done.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const parsed = parseGenerateRequest(await request.json().catch(() => null));
  if (typeof parsed === "string") return jsonError(parsed, 400);
  let req = parsed;

  // OpenRouter models (and MARYX, which picks them) go out with the user's own key when they saved one.
  const key = req.provider === "openrouter" || req.provider === "maryx" ? await ownKey(user.id) : undefined;
  // MARYX picks the real model itself; the gallery shows it as MARYX's.
  if (req.provider === "maryx") {
    try {
      const pick = await maryxMediaModel(req.kind, key !== undefined);
      req = { ...req, provider: pick.provider, model: pick.id };
    } catch (err) {
      return jsonError(describeAiError(err), 503);
    }
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

  let row;
  try {
    row = await createMedia(user, req, paid);
  } catch (err) {
    await refundCharge(paid);
    throw err;
  }
  const call = { key: paid.key, endUser: endUserId(user.id) };
  try {
    return Response.json(await applyResult(row, await startGeneration(req, call), call));
  } catch (err) {
    console.error("[generate]", req.provider, req.model, err);
    return Response.json(await applyResult(row, { status: "failed", error: describeAiError(err, req.provider, Boolean(paid.key)) }));
  }
}
