import { requireUser } from "@/lib/server/http";
import { listModels } from "@/lib/server/models";
import { ownKeyInfo } from "@/lib/server/own-key";
import type { Capability } from "@/lib/types";

const CAPABILITIES = new Set<string>(["chat", "image", "video"]);

/** Providers (with connection status) and the models available to this user. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const param = new URL(request.url).searchParams.get("capability");
  const capability = param && CAPABILITIES.has(param) ? (param as Capability) : null;
  // A user with their own OpenRouter key gets OpenRouter's models even when the site has no key.
  const ownKey = Boolean(await ownKeyInfo(user.id));
  return Response.json(await listModels(capability, { ownKey }), {
    headers: { "Cache-Control": "no-store" },
  });
}
