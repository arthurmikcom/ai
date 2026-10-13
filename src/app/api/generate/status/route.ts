import { describeError } from "@/lib/server/errors";
import { checkGeneration } from "@/lib/server/media";
import { isProvider } from "@/lib/server/validate";
import type { GenerateResult } from "@/lib/types";

/** Polls a pending generation job. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const provider = params.get("provider");
  const kind = params.get("kind");
  const jobId = params.get("jobId");
  if (!isProvider(provider) || (kind !== "image" && kind !== "video") || !jobId) {
    return Response.json({ status: "failed", error: "Неверный запрос" } satisfies GenerateResult, {
      status: 400,
    });
  }
  try {
    return Response.json(await checkGeneration(provider, kind, jobId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[generate/status]", provider, jobId, err);
    // A 502 tells the client the failure may be transient; it retries a few
    // times before marking the job as failed.
    return Response.json({ status: "failed", error: describeError(err) } satisfies GenerateResult, {
      status: 502,
    });
  }
}
