// Images and video through OpenRouter, so one OPENROUTER_API_KEY covers them too.
// Images: POST /images answers with the finished picture (base64); the
// user's photos to edit go along as input_references (data URLs).
// Video: POST /videos starts an async job; we poll GET /videos/{id} and then
// download GET /videos/{id}/content?index=N with the key.

import type { GenerateRequest, GenerateResult, MediaOutput } from "@/lib/types";
import { openRouterBase, openRouterKey } from "../config";
import { HttpError } from "../errors";
import { openRouterImageParams, openRouterVideoCaps } from "../models";

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
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string; metadata?: { provider_name?: string; raw?: unknown; reasons?: unknown } };
    } | null;
    // The upstream provider's own answer says why (OpenRouter's message is often generic).
    const meta = body?.error?.metadata;
    const raw = typeof meta?.raw === "string" ? meta.raw : meta?.raw === undefined ? undefined : JSON.stringify(meta.raw);
    const detail = [meta?.provider_name, raw, meta?.reasons ? JSON.stringify(meta.reasons) : undefined]
      .filter(Boolean)
      .join(": ")
      .slice(0, 500);
    throw new HttpError(res.status, body?.error?.message ?? res.statusText, detail || undefined);
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

/** A model's described parameter: { type: "enum", values } or { type: "range", min, max }. */
function described(params: Record<string, unknown> | undefined, name: string): { values?: unknown[]; max?: number } | null | undefined {
  if (!params) return undefined;
  const value = params[name];
  if (value === undefined) return null;
  return typeof value === "object" && value !== null ? (value as { values?: unknown[]; max?: number }) : {};
}

/**
 * The request body for one picture. Only what the model accepts goes along
 * (OpenRouter answers 400 to a parameter no provider of the model serves);
 * before the model list has loaded, the usual parameters are sent.
 */
export function openRouterImageBody(req: GenerateRequest, endUser?: string): Record<string, unknown> {
  const params = openRouterImageParams(req.model);
  const photos = req.images ?? [];
  const body: Record<string, unknown> = { model: req.model, prompt: req.prompt };
  if (photos.length) {
    const max = described(params, "input_references")?.max;
    const count = typeof max === "number" && max >= 1 ? Math.min(photos.length, max) : photos.length;
    body.input_references = photos.slice(0, count).map((p) => ({
      type: "image_url",
      image_url: { url: `data:${p.mime};base64,${p.data}` },
    }));
  }
  // An edited photo keeps its proportions (a ratio would crop or pad it); a character's new scene takes the chosen one.
  if (!photos.length || req.character) {
    const ratio = described(params, "aspect_ratio");
    if (ratio !== null && (!Array.isArray(ratio?.values) || ratio.values.includes(req.aspectRatio))) {
      body.aspect_ratio = req.aspectRatio;
    }
  }
  if (endUser) body.user = endUser;
  return body;
}

export async function generateOpenRouterImage(req: GenerateRequest, call: OpenRouterCall = {}): Promise<GenerateResult> {
  const res = await openRouter<ImageResponse>("/images", call, {
    method: "POST",
    body: openRouterImageBody(req, call.endUser),
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

/**
 * The request body for one clip. Only what the model takes goes along
 * (OpenRouter answers 400 otherwise); before the model list has loaded, the
 * usual parameters are sent. With the user's photo, it is the first frame.
 */
export function openRouterVideoBody(req: GenerateRequest, endUser?: string): Record<string, unknown> {
  const caps = openRouterVideoCaps(req.model);
  const body: Record<string, unknown> = { model: req.model, prompt: req.prompt };
  const photo = req.images?.[0];
  if (photo) {
    // The clip keeps the photo's proportions; a ratio would crop or pad it.
    body.frame_images = [
      { type: "image_url", image_url: { url: `data:${photo.mime};base64,${photo.data}` }, frame_type: "first_frame" },
    ];
  } else if (!caps?.aspectRatios || caps.aspectRatios.includes(req.aspectRatio)) {
    body.aspect_ratio = req.aspectRatio;
  }
  const asked = req.duration;
  if (asked) {
    // The supported length closest to the one asked for.
    const allowed = caps?.durations?.length ? caps.durations : [asked];
    body.duration = allowed.reduce((best, d) => (Math.abs(d - asked) < Math.abs(best - asked) ? d : best));
  }
  if (endUser) body.user = endUser;
  return body;
}

export async function startOpenRouterVideo(req: GenerateRequest, call: OpenRouterCall = {}): Promise<GenerateResult> {
  const job = await openRouter<VideoJob>("/videos", call, { method: "POST", body: openRouterVideoBody(req, call.endUser) });
  return toResult(job);
}

export async function checkOpenRouterVideo(jobId: string, call: OpenRouterCall = {}): Promise<GenerateResult> {
  if (!JOB_ID.test(jobId)) return { status: "failed", error: "Неверный идентификатор задачи." };
  return toResult(await openRouter<VideoJob>(`/videos/${encodeURIComponent(jobId)}`, call));
}
