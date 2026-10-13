import { describeError } from "@/lib/server/errors";
import { applyResult, createMedia } from "@/lib/server/gallery";
import { jsonError, requireUser } from "@/lib/server/http";
import { startGeneration } from "@/lib/server/media";
import { consume, limitResponse } from "@/lib/server/usage";
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

  if (!(await consume(user, req.kind))) return limitResponse(user, req.kind);

  const row = await createMedia(user, req);
  try {
    return Response.json(await applyResult(row, await startGeneration(req)));
  } catch (err) {
    console.error("[generate]", req.provider, req.model, err);
    return Response.json(await applyResult(row, { status: "failed", error: describeError(err) }));
  }
}
