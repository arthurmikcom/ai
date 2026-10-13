import { describeError } from "@/lib/server/errors";
import { startGeneration } from "@/lib/server/media";
import { parseGenerateRequest } from "@/lib/server/validate";
import type { GenerateResult } from "@/lib/types";

export const maxDuration = 120;

/** Starts an image or video generation. Slow jobs come back as "pending". */
export async function POST(request: Request) {
  const req = parseGenerateRequest(await request.json().catch(() => null));
  if (typeof req === "string") {
    return Response.json({ status: "failed", error: req } satisfies GenerateResult, { status: 400 });
  }
  try {
    return Response.json(await startGeneration(req));
  } catch (err) {
    console.error("[generate]", req.provider, req.model, err);
    return Response.json({ status: "failed", error: describeError(err) } satisfies GenerateResult);
  }
}
