// The free plan's pictures: Pollinations' public image endpoint, an open model
// (FLUX) with no key and no fee per picture. It is shared and limited per
// server address, so MARYX keeps it for the free plan (paid plans draw with
// GPT Image).

import type { AspectRatio, GenerateRequest, GenerateResult, ModelInfo } from "@/lib/types";
import { apiKey, pollinationsBase } from "../config";

export const POLLINATIONS_MODEL = "pollinations/flux";

export function pollinationsModels(): ModelInfo[] {
  return [{ provider: "pollinations", id: POLLINATIONS_MODEL, label: "FLUX (бесплатно)", capability: "image", featured: true }];
}

/** Sizes FLUX was made for, by shape (multiples of 32). */
const SIZES: Record<AspectRatio, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "4:3": [1152, 896],
  "3:4": [896, 1152],
};

const TIMEOUT_MS = 90_000;
const MAX_BYTES = 20 * 1024 * 1024;

export async function generatePollinationsImage(req: GenerateRequest): Promise<GenerateResult> {
  const [width, height] = SIZES[req.aspectRatio] ?? SIZES["1:1"];
  const token = apiKey("pollinations");
  const url = new URL(`${pollinationsBase()}/${encodeURIComponent(req.prompt.trim().slice(0, 1500))}`);
  const seed = String(Math.floor(Math.random() * 2 ** 31));
  // With a key, its current address and its own model; without one, the old keyless address.
  url.search = new URLSearchParams(
    token
      ? { width: String(width), height: String(height), seed }
      : {
          model: "flux",
          width: String(width),
          height: String(height),
          seed,
          nologo: "true",
          // Not shown in its public feed.
          private: "true",
          // FLUX reads English best: a prompt in another language is rewritten (by Pollinations, free).
          ...(/[^\x00-\x7F]/.test(req.prompt) ? { enhance: "true" } : {}),
          referrer: "maryx",
        },
  ).toString();
  let res: Response;
  try {
    res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { status: "failed", error: "Бесплатная нейросеть не ответила — попробуйте ещё раз через минуту." };
  }
  if (res.status === 429) return { status: "failed", error: "Бесплатная нейросеть сейчас занята — попробуйте через минуту." };
  if (res.status === 401 || res.status === 402 || res.status === 403) {
    console.error("[pollinations] refused", res.status, await res.text().catch(() => ""));
    return { status: "failed", error: "Бесплатная нейросеть сейчас недоступна. Картинки GPT Image — на платном тарифе или за кредиты." };
  }
  if (!res.ok) return { status: "failed", error: `Бесплатная нейросеть не смогла нарисовать (${res.status}) — попробуйте ещё раз.` };
  const mime = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const data = Buffer.from(await res.arrayBuffer());
  if (!/^image\/(jpeg|png|webp)$/.test(mime) || data.length < 100 || data.length > MAX_BYTES) {
    return { status: "failed", error: "Бесплатная нейросеть вернула не картинку — попробуйте ещё раз." };
  }
  return { status: "succeeded", outputs: [{ type: "base64", mime, data: data.toString("base64") }] };
}
