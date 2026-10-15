import type { GenerateRequest, GenerateResult, MediaKind, MediaOutput, ProviderId } from "@/lib/types";
import { apiKey, openRouterBase } from "../config";
import { checkGoogleVideo, generateGoogleImage, startGoogleVideo } from "./google";
import { generateOpenAIImage } from "./openai";
import { checkOpenRouterVideo, generateOpenRouterImage, startOpenRouterVideo } from "./openrouter";
import { checkReplicate, startReplicate } from "./replicate";

export async function startGeneration(req: GenerateRequest): Promise<GenerateResult> {
  if (req.provider === "replicate") return startReplicate(req);
  if (req.provider === "google") {
    return req.kind === "image" ? generateGoogleImage(req) : startGoogleVideo(req);
  }
  if (req.provider === "openai" && req.kind === "image") return generateOpenAIImage(req);
  if (req.provider === "openrouter") {
    return req.kind === "image" ? generateOpenRouterImage(req) : startOpenRouterVideo(req);
  }
  return {
    status: "failed",
    error: `Провайдер ${req.provider} не умеет генерировать ${req.kind === "image" ? "изображения" : "видео"}.`,
  };
}

export async function checkGeneration(
  provider: ProviderId,
  kind: MediaKind,
  jobId: string,
): Promise<GenerateResult> {
  if (provider === "replicate") return checkReplicate(jobId);
  if (provider === "google" && kind === "video") return checkGoogleVideo(jobId);
  if (provider === "openrouter" && kind === "video") return checkOpenRouterVideo(jobId);
  return { status: "failed", error: "Для этого провайдера нет фоновых задач." };
}

/**
 * Hosts we download generated media from. Anything else is refused, so a
 * provider response can never make the server fetch an arbitrary URL.
 */
function mediaSource(
  provider: ProviderId,
  rawUrl: string,
): { url: URL; headers: Record<string, string> } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  // OpenRouter videos are downloaded from its own API with our key. The URL
  // is built by us from the job id, and is checked against the API root
  // (which may be a local mock over http in tests).
  if (provider === "openrouter") {
    const base = new URL(openRouterBase());
    const key = apiKey("openrouter");
    const videos = `${base.pathname.replace(/\/+$/, "")}/videos/`;
    return key && url.origin === base.origin && url.pathname.startsWith(videos)
      ? { url, headers: { Authorization: `Bearer ${key}` } }
      : null;
  }
  if (url.protocol !== "https:") return null;

  if (
    provider === "replicate" &&
    (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery"))
  ) {
    return { url, headers: {} };
  }
  if (provider === "google" && url.hostname === "generativelanguage.googleapis.com") {
    const key = apiKey("google");
    return key ? { url, headers: { "x-goog-api-key": key } } : null;
  }
  return null;
}

/** Fetches one generated output as bytes ready to be stored. */
export async function downloadOutput(
  provider: ProviderId,
  output: MediaOutput,
  kind: MediaKind,
): Promise<{ body: Buffer | ReadableStream<Uint8Array>; mime: string }> {
  if (output.type === "base64") {
    return { body: Buffer.from(output.data, "base64"), mime: output.mime };
  }
  const source = mediaSource(provider, output.url);
  if (!source) throw new Error("Недопустимый адрес результата");

  let res = await fetch(source.url, { headers: source.headers, redirect: "manual" });
  // Google answers with a redirect to signed storage; follow it without our
  // API key so the key never leaves the provider's own host.
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    const next = new URL(location, source.url);
    if (next.protocol !== "https:") throw new Error("Недопустимый редирект");
    res = await fetch(next);
  }
  if (!res.ok || !res.body) throw new Error("Не удалось скачать результат");

  const type = res.headers.get("content-type")?.split(";")[0].trim();
  const fallback = kind === "video" ? "video/mp4" : "image/png";
  const mime = type && /^(image|video)\//.test(type) ? type : fallback;
  return { body: res.body, mime };
}
