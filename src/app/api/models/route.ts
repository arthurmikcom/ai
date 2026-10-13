import { listModels } from "@/lib/server/models";
import type { Capability } from "@/lib/types";

const CAPABILITIES = new Set<string>(["chat", "image", "video"]);

/** Providers (with connection status) and the models available to this server. */
export async function GET(request: Request) {
  const param = new URL(request.url).searchParams.get("capability");
  const capability = param && CAPABILITIES.has(param) ? (param as Capability) : null;
  return Response.json(await listModels(capability), {
    headers: { "Cache-Control": "no-store" },
  });
}
