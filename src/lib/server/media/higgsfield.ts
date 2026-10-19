import type { GenerateRequest, GenerateResult } from "@/lib/types";
import { higgsfieldBase, motionResolution, requireKey } from "../config";
import { HttpError } from "../errors";
import { getFile } from "../storage";

// «Тренд», move for move: Higgsfield's Genjutsu motion transfer. The trend
// video and the new people's photos go to Higgsfield's storage, and the model
// makes the same video with them in it — every move, cut and camera turn.

export const MOTION_MODEL = "higgsfield/genjutsu/motion-transfer/v1.0";
/** The video it takes: at least 4 seconds (a longer one is cut to 30). */
export const MOTION_MIN_SECONDS = 4;
export const MOTION_MAX_SECONDS = 30;
/** Pictures of the new people it takes at most. */
export const MOTION_MAX_REFERENCES = 8;

interface Request {
  status?: string;
  request_id?: string;
  video?: { url?: string };
  videos?: { url?: string }[];
  error?: string;
  progress?: number;
}

async function higgsfield<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${higgsfieldBase()}${path}`, {
    ...init,
    headers: { Authorization: `Key ${requireKey("higgsfield")}`, "Content-Type": "application/json", Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
      const said = [body.detail, body.message, body.error].find((v) => typeof v === "string");
      if (typeof said === "string") message = said;
    } catch {
      // keep statusText
    }
    throw new HttpError(res.status, message, text.slice(0, 500));
  }
  return (await res.json()) as T;
}

/** One file onto Higgsfield's storage (a presigned upload): its public URL, for the model to read. */
async function upload(body: Buffer, contentType: string): Promise<string> {
  const slot = await higgsfield<{ upload_url?: string; public_url?: string; upload_headers?: Record<string, string> }>(
    "/files/generate-upload-url",
    { method: "POST", body: JSON.stringify({ content_type: contentType }) },
  );
  if (!slot.upload_url || !slot.public_url) throw new HttpError(502, "Higgsfield не дал адрес для загрузки");
  // The storage gets the file with the headers it signed for — never our key.
  const res = await fetch(slot.upload_url, {
    method: "PUT",
    body: new Uint8Array(body),
    headers: { "Content-Type": contentType, ...slot.upload_headers },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new HttpError(res.status, "Не удалось загрузить файл в Higgsfield", (await res.text().catch(() => "")).slice(0, 500));
  return slot.public_url;
}

/** What the model is asked: who becomes whom; everything else stays as in the video. */
export function motionPrompt(plan?: { who: string; first: number; count: number }[]): string {
  const roles = plan?.length
    ? plan.map((p) => `the ${p.who} becomes the person in image${p.count > 1 ? `s ${p.first}–${p.first + p.count - 1}` : ` ${p.first}`}`).join("; ")
    : "the main person becomes the person in the images";
  return (
    `Replace the people of the video: ${roles}. Each new person must be unmistakably the one in their images — the same ` +
    "face, hair, skin tone and build — as an adult, natural and photorealistic. Keep everything else exactly as in the video: " +
    "every movement, gesture and expression in time, the clothing, the place and background, the other people, the camera " +
    "moves, framing and cuts, the light and colors."
  );
}

function toResult(r: Request, jobId?: string): GenerateResult {
  const status = r.status?.toLowerCase();
  if (status === "completed") {
    const url = r.video?.url ?? r.videos?.find((v) => v.url)?.url;
    return url ? { status: "succeeded", outputs: [{ type: "url", url }] } : { status: "failed", error: "Модель ничего не вернула." };
  }
  if (status === "nsfw") return { status: "failed", error: "Видео не прошло проверку на недопустимое содержимое." };
  if (status === "failed" || status === "canceled" || status === "cancelled") {
    return { status: "failed", error: `Не получилось повторить движения${r.error ? `: ${r.error}` : ""}. Попробуйте другое фото или другой ролик.` };
  }
  const id = jobId ?? r.request_id;
  if (!id) return { status: "failed", error: "Задача не принята — попробуйте ещё раз." };
  const progress = typeof r.progress === "number" && r.progress >= 0 ? Math.min(100, Math.round(r.progress <= 1 ? r.progress * 100 : r.progress)) : undefined;
  return { status: "pending", jobId: id, ...(progress !== undefined ? { progress } : {}) };
}

/** Starts the move-for-move remake of `req.motion`'s video with the people in `req.images`. */
export async function startMotionTransfer(req: GenerateRequest): Promise<GenerateResult> {
  if (!req.motion) return { status: "failed", error: "Нет видео тренда." };
  const stored = await getFile(req.motion.key);
  if (!stored) return { status: "failed", error: "Видео тренда не найдено — загрузите его ещё раз." };
  const video = Buffer.from(await new Response(stored.body).arrayBuffer());
  const pictures = (req.images ?? []).slice(0, MOTION_MAX_REFERENCES);
  if (!pictures.length) return { status: "failed", error: "Нужно фото героя." };
  const [videoUrl, ...imageUrls] = await Promise.all([
    upload(video, "video/mp4"),
    ...pictures.map((p) => upload(Buffer.from(p.data, "base64"), p.mime === "image/jpg" ? "image/jpeg" : p.mime)),
  ]);
  const job = await higgsfield<Request>(`/${MOTION_MODEL}`, {
    method: "POST",
    body: JSON.stringify({ video_url: videoUrl, image_urls: imageUrls, prompt: req.prompt.slice(0, 10_000), resolution: motionResolution() }),
  });
  return toResult(job);
}

export async function checkMotionTransfer(jobId: string): Promise<GenerateResult> {
  if (!/^[\w-]+$/.test(jobId)) return { status: "failed", error: "Неверный идентификатор задачи." };
  return toResult(await higgsfield<Request>(`/requests/${jobId}/status`), jobId);
}
