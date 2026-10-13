import type { GenerateRequest, GenerateResult, MediaOutput } from "@/lib/types";
import { requireKey } from "../config";
import { HttpError } from "../errors";

const API = "https://api.replicate.com/v1";

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
  logs?: string;
}

async function replicate(path: string, init?: RequestInit): Promise<Prediction> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireKey("replicate")}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string; title?: string };
      detail = body.detail ?? body.title ?? detail;
    } catch {
      // keep statusText
    }
    throw new HttpError(res.status, detail);
  }
  return (await res.json()) as Prediction;
}

/** Collects every URL in a prediction's output (string, list or object). */
function outputUrls(output: unknown): string[] {
  if (typeof output === "string") return /^https?:\/\//.test(output) ? [output] : [];
  if (Array.isArray(output)) return output.flatMap(outputUrls);
  if (output && typeof output === "object") return Object.values(output).flatMap(outputUrls);
  return [];
}

/** Last "NN%" in the logs — most video models print a progress bar. */
function progressFromLogs(logs: string | undefined): number | undefined {
  const matches = logs?.match(/(\d{1,3})%/g);
  if (!matches?.length) return undefined;
  return Math.min(100, parseInt(matches[matches.length - 1], 10));
}

function toResult(p: Prediction): GenerateResult {
  if (p.status === "succeeded") {
    const outputs: MediaOutput[] = outputUrls(p.output).map((url) => ({ type: "url", url }));
    return outputs.length
      ? { status: "succeeded", outputs }
      : { status: "failed", error: "Модель ничего не вернула." };
  }
  if (p.status === "failed" || p.status === "canceled") {
    return { status: "failed", error: p.error || "Генерация не удалась." };
  }
  return { status: "pending", jobId: p.id, progress: progressFromLogs(p.logs) };
}

export async function startReplicate(req: GenerateRequest): Promise<GenerateResult> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(req.model)) {
    return { status: "failed", error: "Модель Replicate указывается как owner/name." };
  }
  const prediction = await replicate(`/models/${req.model}/predictions`, {
    method: "POST",
    // Images usually finish within a minute, so wait for them synchronously.
    headers: req.kind === "image" ? { Prefer: "wait=60" } : undefined,
    body: JSON.stringify({ input: { prompt: req.prompt, aspect_ratio: req.aspectRatio } }),
  });
  return toResult(prediction);
}

export async function checkReplicate(jobId: string): Promise<GenerateResult> {
  if (!/^\w+$/.test(jobId)) return { status: "failed", error: "Неверный идентификатор задачи." };
  return toResult(await replicate(`/predictions/${jobId}`));
}
