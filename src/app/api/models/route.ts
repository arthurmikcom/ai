import { MARYX_IMAGE_MODEL, MARYX_VIDEO_MODEL } from "@/lib/catalog";
import { isAdmin } from "@/lib/server/auth";
import { maryxOnly } from "@/lib/server/config";
import { requireUser } from "@/lib/server/http";
import { listModels } from "@/lib/server/models";
import { ownKeyInfo } from "@/lib/server/own-key";
import type { Capability, ModelInfo, ModelsResponse } from "@/lib/types";

const CAPABILITIES = new Set<string>(["chat", "image", "video"]);

/** Providers (with connection status) and the models available to this user. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const param = new URL(request.url).searchParams.get("capability");
  const capability = param && CAPABILITIES.has(param) ? (param as Capability) : null;
  // A user with their own OpenRouter key gets OpenRouter's models even when the site has no key.
  const ownKey = Boolean(await ownKeyInfo(user.id));
  const all = await listModels(capability, { ownKey });
  const body: ModelsResponse =
    maryxOnly() && !(capability === null && isAdmin(user)) ? { ...onlyMaryx(all, capability), maryxOnly: true } : all;
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * MARYX-only mode: MARYX stands for every model it can use (chat, pictures,
 * video), and the providers behind it aren't listed. Admins still get the
 * full list for their settings page (capability "all").
 */
function onlyMaryx(all: ModelsResponse, capability: Capability | null): ModelsResponse {
  const has = (c: Capability) => all.models.some((m) => m.capability === c && m.provider !== "maryx" && m.provider !== "browser");
  const models: ModelInfo[] = [];
  if (!capability || capability === "chat") {
    const maryx = all.models.find((m) => m.provider === "maryx" && m.capability === "chat");
    if (maryx) models.push(maryx.local ? { ...maryx, description: "Наш ИИ: работает прямо в вашем браузере — бесплатно" } : maryx);
  }
  if ((!capability || capability === "image") && has("image")) models.push(MARYX_IMAGE_MODEL);
  if ((!capability || capability === "video") && has("video")) models.push(MARYX_VIDEO_MODEL);
  return { providers: [], models };
}
