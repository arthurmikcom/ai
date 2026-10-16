import { describeError } from "@/lib/server/errors";
import { applyResult, createMedia } from "@/lib/server/gallery";
import { jsonError, requireUser } from "@/lib/server/http";
import { startGeneration } from "@/lib/server/media";
import { endUserId, ownKey } from "@/lib/server/own-key";
import { charge, deniedResponse } from "@/lib/server/usage";
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

  const req = parseGenerateRequest(await request.json().catch(() => null));
  if (typeof req === "string") return jsonError(req, 400);

  // OpenRouter models go out with the user's own key when they saved one.
  const key = req.provider === "openrouter" ? await ownKey(user.id) : undefined;
  const paid = await charge(user, req.kind, key);
  if ("denied" in paid) return deniedResponse(user, req.kind, paid.denied);

  const row = await createMedia(user, req, paid);
  const call = { key: paid.key, endUser: endUserId(user.id) };
  try {
    return Response.json(await applyResult(row, await startGeneration(req, call), call));
  } catch (err) {
    console.error("[generate]", req.provider, req.model, err);
    return Response.json(await applyResult(row, { status: "failed", error: describeError(err, req.provider, Boolean(paid.key)) }));
  }
}
