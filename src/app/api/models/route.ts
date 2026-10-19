import { MARYX_IMAGE_MODEL, MARYX_VIDEO_MODEL } from "@/lib/catalog";
import { isAdmin } from "@/lib/server/auth";
import { isConfigured, maryxOnly } from "@/lib/server/config";
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
  if ((!capability || capability === "image") && has("image")) {
    // The studio offers "upload a photo" when MARYX has a model that edits photos.
    const photoEdit = all.models.some((m) => m.capability === "image" && m.photoEdit);
    models.push(photoEdit ? { ...MARYX_IMAGE_MODEL, photoEdit } : MARYX_IMAGE_MODEL);
  }
  if ((!capability || capability === "video") && has("video")) {
    // …and "animate a photo" when one of its video models starts from a photo.
    const photoEdit = all.models.some((m) => m.capability === "video" && m.photoEdit);
    // …and a transition between two frames when one of them also ends on a given picture.
    const lastFrame = all.models.some((m) => m.capability === "video" && m.photoEdit && m.lastFrame);
    // …and «Тренд» move for move when Higgsfield is connected.
    const motion = isConfigured("higgsfield");
    models.push({ ...MARYX_VIDEO_MODEL, ...(photoEdit ? { photoEdit } : {}), ...(lastFrame ? { lastFrame } : {}), ...(motion ? { motion } : {}) });
  }
  return { providers: [], models };
}
