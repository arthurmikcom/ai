// Images and video through OpenRouter, so one OPENROUTER_API_KEY covers them too.
// Images: POST /images answers with the finished picture (base64).
// Video: POST /videos starts an async job; we poll GET /videos/{id} and then
// download GET /videos/{id}/content?index=N with the key.

import type { GenerateRequest, GenerateResult, MediaOutput } from "@/lib/types";
import { openRouterBase, openRouterKey } from "../config";
import { HttpError } from "../errors";

/** Options of one call: the user's own key (BYOK) and their pseudonym for OpenRouter. */
export interface OpenRouterCall {
  key?: string;
  endUser?: string;
}

async function openRouter<T>(path: string, call: OpenRouterCall, init?: { method: "POST"; body: unknown }): Promise<T> {
  const res = await fetch(`${openRouterBase()}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${openRouterKey(call.key)}`,
      "X-Title": "MARYX Ai",
      ...(init ? { "Content-Type": "application/json" } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new HttpError(res.status, detail?.error?.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

interface ImageResponse {
  data?: { b64_json?: string; media_type?: string }[];
  /** "when available"; cost in USD. */
  usage?: { cost?: number | null };
}

const costOf = (usage?: { cost?: number | null }) =>
  typeof usage?.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : undefined;

export async function generateOpenRouterImage(req: GenerateRequest, call: OpenRouterCall = {}): Promise<GenerateResult> {
  const res = await openRouter<ImageResponse>("/images", call, {
    method: "POST",
    body: {
      model: req.model,
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio,
      n: 1,
      ...(call.endUser ? { user: call.endUser } : {}),
    },
  });
  const outputs: MediaOutput[] = (res.data ?? []).flatMap((d): MediaOutput[] =>
    d.b64_json ? [{ type: "base64", mime: d.media_type || "image/png", data: d.b64_json }] : [],
  );
  if (outputs.length === 0) return { status: "failed", error: "Модель не вернула изображение." };
  return { status: "succeeded", outputs, cost: costOf(res.usage) };
}

interface VideoJob {
  id: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";
  unsigned_urls?: string[];
  error?: string;
  /** Once completed; cost in USD. */
  usage?: { cost?: number | null };
}

const JOB_ID = /^[\w-]{1,128}$/;

/** Where one finished video can be downloaded (needs the API key). */
export function openRouterVideoUrl(jobId: string, index: number): string {
  return `${openRouterBase()}/videos/${encodeURIComponent(jobId)}/content?index=${index}`;
}

function toResult(job: VideoJob): GenerateResult {
  if (job.status === "completed") {
    const count = Math.max(1, job.unsigned_urls?.length ?? 0);
    const outputs: MediaOutput[] = Array.from({ length: count }, (_, i) => ({
      type: "url",
      url: openRouterVideoUrl(job.id, i),
    }));
    return { status: "succeeded", outputs, cost: costOf(job.usage) };
  }
  if (job.status === "failed") return { status: "failed", error: job.error || "Генерация не удалась." };
  if (job.status === "cancelled") return { status: "failed", error: "Генерация отменена." };
  if (job.status === "expired") return { status: "failed", error: "Видео больше недоступно у провайдера." };
  if (!JOB_ID.test(job.id ?? "")) return { status: "failed", error: "OpenRouter не вернул номер задачи." };
  return { status: "pending", jobId: job.id };
}

export async function startOpenRouterVideo(req: GenerateRequest, call: OpenRouterCall = {}): Promise<GenerateResult> {
  const job = await openRouter<VideoJob>("/videos", call, {
    method: "POST",
    body: {
      model: req.model,
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio,
      ...(req.duration ? { duration: req.duration } : {}),
      ...(call.endUser ? { user: call.endUser } : {}),
    },
  });
  return toResult(job);
}

export async function checkOpenRouterVideo(jobId: string, call: OpenRouterCall = {}): Promise<GenerateResult> {
  if (!JOB_ID.test(jobId)) return { status: "failed", error: "Неверный идентификатор задачи." };
  return toResult(await openRouter<VideoJob>(`/videos/${encodeURIComponent(jobId)}`, call));
}
