import type { GenerateRequest, GenerateResult, MediaKind, ProviderId } from "@/lib/types";
import { apiKey } from "../config";
import { checkGoogleVideo, generateGoogleImage, startGoogleVideo } from "./google";
import { generateOpenAIImage } from "./openai";
import { checkReplicate, startReplicate } from "./replicate";

export async function startGeneration(req: GenerateRequest): Promise<GenerateResult> {
  if (req.provider === "replicate") return startReplicate(req);
  if (req.provider === "google") {
    return req.kind === "image" ? generateGoogleImage(req) : startGoogleVideo(req);
  }
  if (req.provider === "openai" && req.kind === "image") return generateOpenAIImage(req);
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
  return { status: "failed", error: "Для этого провайдера нет фоновых задач." };
}

/**
 * Hosts we are willing to download generated media from on the user's behalf.
 * Anything else is refused so the media proxy can't be used to reach
 * arbitrary URLs from the server.
 */
export function mediaSource(
  provider: ProviderId,
  rawUrl: string,
): { url: URL; headers: Record<string, string> } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
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
