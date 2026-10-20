import { MARYX_IMAGE_MODEL, MARYX_VIDEO_MODEL } from "@/lib/catalog";
import { isAdmin } from "@/lib/server/auth";
import { creditValueUsd, MIN_CREDITS } from "@/lib/server/billing/credits";
import { maryxMediaModels } from "@/lib/server/chat/image";
import { isConfigured, maryxOnly } from "@/lib/server/config";
import { requireUser } from "@/lib/server/http";
import { listModels } from "@/lib/server/models";
import { ownKeyInfo } from "@/lib/server/own-key";
import { mediaCost } from "@/lib/server/pricing";
import type { Capability, ModelInfo, ModelsResponse } from "@/lib/types";

const CAPABILITIES = new Set<string>(["chat", "image", "video"]);

/** Providers (with connection status) and the models available to this user. */
export async function GET(request: Request) {
  const user = await requireUser(request, { guest: true });
  if (user instanceof Response) return user;
  const param = new URL(request.url).searchParams.get("capability");
  const capability = param && CAPABILITIES.has(param) ? (param as Capability) : null;
  // A user with their own OpenRouter key gets OpenRouter's models even when the site has no key.
  const ownKey = Boolean(await ownKeyInfo(user.id));
  const all = await listModels(capability, { ownKey });
  const body: ModelsResponse =
    maryxOnly() && !(capability === null && isAdmin(user)) ? { ...onlyMaryx(all, capability), maryxOnly: true } : all;
  // The video section names its models: MARYX Ai Video (which picks one itself) first, then each by its maker.
  if (capability === "video" && body.models.length) {
    const usual = (await maryxMediaModels("video", ownKey))[0];
    const real = all.models.filter((m) => m.capability === "video" && m.provider !== "maryx");
    body.models = [
      ...body.models.filter((m) => m.provider === "maryx").map((m) => ({ ...m, vendor: "MARYX", credits: clipCredits(usual?.id ?? m.id) })),
      ...[...real.filter((m) => m.featured), ...real.filter((m) => !m.featured)].map((m) => ({
        ...m,
        // OpenRouter names its models "Maker: Model"; the maker is shown apart.
        label: m.label.replace(/^[^:]{2,30}:\s*/, ""),
        vendor: vendorOf(m),
        credits: clipCredits(m.id),
      })),
    ];
  }
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/** What a clip of a model costs in credits: per second, and the least a clip takes. */
function clipCredits(model: string): { perSecond: number; least: number } {
  const perSecond = mediaCost("video", model, 1) / creditValueUsd();
  return { perSecond: Math.round(perSecond * 100) / 100, least: MIN_CREDITS.video };
}

/** Who made a video model, by its id ("google/veo-3.1" → Google). */
const VENDORS: [RegExp, string][] = [
  [/veo|^google\//, "Google"],
  [/kling|kwaivgi/, "Kling AI"],
  [/seedance|bytedance/, "ByteDance"],
  [/hailuo|minimax/, "MiniMax"],
  [/wan|alibaba/, "Alibaba"],
  [/sora|^openai\//, "OpenAI"],
  [/luma|ray-/, "Luma"],
  [/runway|gen-4/, "Runway"],
  [/pika/, "Pika"],
  [/ltx|lightricks/, "Lightricks"],
  [/hunyuan|tencent/, "Tencent"],
  [/grok|x-ai/, "xAI"],
];

function vendorOf(m: ModelInfo): string {
  // The site's own GPU runs open models.
  if (m.provider === "comfy") return "Сервер MARYX";
  const id = m.id.toLowerCase();
  const known = VENDORS.find(([re]) => re.test(id))?.[1];
  if (known) return known;
  // OpenRouter names its models "Maker: Model".
  const named = /^([^:]{2,30}):/.exec(m.label)?.[1];
  if (named) return named;
  const prefix = id.split("/")[0];
  return prefix && prefix !== id ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : m.label;
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
