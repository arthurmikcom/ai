import type { AspectRatio, GenerateRequest, GenerateResult, MediaKind, MediaOutput, ModelInfo } from "@/lib/types";
import { apiKey, comfyBase } from "../config";
import { HttpError } from "../errors";

// Free open models on the site's own GPU: ComfyUI (github.com/comfyanonymous/ComfyUI)
// with FLUX.1 schnell for pictures and Wan 2.2 5B for video (text or a photo
// to video). No per-request fees — only the GPU's time. The workflows are
// ComfyUI's own templates (Comfy-Org/workflow_templates) in API form; an admin
// can swap in their own (COMFYUI_IMAGE_WORKFLOW, COMFYUI_VIDEO_WORKFLOW).

export const COMFY_IMAGE_MODEL = "comfy/flux-schnell";
export const COMFY_VIDEO_MODEL = "comfy/wan2.2-5b";

/** The models it offers: a picture from words; a clip from words or from a photo (its first frame). */
export function comfyModels(kind: MediaKind): ModelInfo[] {
  return kind === "image"
    ? [{ provider: "comfy", id: COMFY_IMAGE_MODEL, label: "FLUX.1 schnell (свой GPU)", capability: "image", featured: true }]
    : [{ provider: "comfy", id: COMFY_VIDEO_MODEL, label: "Wan 2.2 (свой GPU)", capability: "video", featured: true, photoEdit: true }];
}

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

/** Wan's own "what not to show" (from ComfyUI's template). */
const WAN_NEGATIVE =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走";

/** Sizes the models were made for, by shape (multiples of 32). */
const IMAGE_SIZES: Record<AspectRatio, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "4:3": [1152, 896],
  "3:4": [896, 1152],
};
const VIDEO_SIZES: Record<AspectRatio, [number, number]> = {
  "1:1": [960, 960],
  "16:9": [1280, 704],
  "9:16": [704, 1280],
  "4:3": [1088, 832],
  "3:4": [832, 1088],
};
/** Wan 2.2 5B: 24 frames a second, up to 5 seconds (121 frames; a length is 4n+1). */
const FPS = 24;
const MAX_FRAMES = 121;

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

function imageWorkflow(prompt: string, width: number, height: number, seed: number): Workflow {
  return {
    "30": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: env("COMFYUI_FLUX_CHECKPOINT", "flux1-schnell-fp8.safetensors") } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["30", 1] } },
    "33": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["30", 1] } },
    "27": { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    "31": {
      class_type: "KSampler",
      inputs: { model: ["30", 0], seed, steps: 4, cfg: 1, sampler_name: "euler", scheduler: "simple", positive: ["6", 0], negative: ["33", 0], latent_image: ["27", 0], denoise: 1 },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["31", 0], vae: ["30", 2] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "maryx/image" } },
  };
}

function videoWorkflow(prompt: string, width: number, height: number, frames: number, seed: number, startImage?: string): Workflow {
  return {
    "37": { class_type: "UNETLoader", inputs: { unet_name: env("COMFYUI_WAN_MODEL", "wan2.2_ti2v_5B_fp16.safetensors"), weight_dtype: "default" } },
    "38": { class_type: "CLIPLoader", inputs: { clip_name: env("COMFYUI_WAN_TEXT_ENCODER", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"), type: "wan", device: "default" } },
    "39": { class_type: "VAELoader", inputs: { vae_name: env("COMFYUI_WAN_VAE", "wan2.2_vae.safetensors") } },
    "48": { class_type: "ModelSamplingSD3", inputs: { model: ["37", 0], shift: 8 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["38", 0] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: WAN_NEGATIVE, clip: ["38", 0] } },
    ...(startImage ? { "56": { class_type: "LoadImage", inputs: { image: startImage } } } : {}),
    "55": {
      class_type: "Wan22ImageToVideoLatent",
      inputs: { vae: ["39", 0], width, height, length: frames, batch_size: 1, ...(startImage ? { start_image: ["56", 0] } : {}) },
    },
    "3": {
      class_type: "KSampler",
      inputs: { model: ["48", 0], seed, steps: 20, cfg: 5, sampler_name: "uni_pc", scheduler: "simple", positive: ["6", 0], negative: ["7", 0], latent_image: ["55", 0], denoise: 1 },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["39", 0] } },
    "57": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: FPS } },
    // "format.codec" for ComfyUI since its nested choices, "codec" for the ones before.
    "58": { class_type: "SaveVideo", inputs: { video: ["57", 0], filename_prefix: "maryx/video", format: "auto", "format.codec": "auto", codec: "auto" } },
  };
}

/**
 * An admin's own workflow (ComfyUI's "Export (API)"), with {{prompt}},
 * {{negative}}, {{width}}, {{height}}, {{frames}}, {{seed}} and {{image}}
 * where the values go.
 */
function ownWorkflow(template: string, values: Record<string, string | number>): Workflow {
  let text = template;
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`"{{${name}}}"`, JSON.stringify(value)).replaceAll(`{{${name}}}`, JSON.stringify(String(value)).slice(1, -1));
  }
  return JSON.parse(text) as Workflow;
}

/** COMFYUI_TOKEN: a bare token goes as "Bearer …"; "Basic …" (a password on the proxy in front) goes as it is. */
function headers(json = true): Record<string, string> {
  const token = apiKey("comfy");
  const authorization = token ? (/^\w+ \S/.test(token) ? token : `Bearer ${token}`) : undefined;
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(authorization ? { Authorization: authorization } : {}) };
}

async function comfy<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${comfyBase()}${path}`, { ...init, headers: { ...headers(!(init?.body instanceof FormData)), ...init?.headers }, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new HttpError(503, "Свой GPU-сервер (ComfyUI) не отвечает — он включён?", err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `ComfyUI ответил ${res.status}`;
    try {
      const body = JSON.parse(text) as { error?: { message?: string; details?: string }; node_errors?: Record<string, { errors?: { message?: string; details?: string }[]; class_type?: string }> };
      const node = Object.values(body.node_errors ?? {})[0];
      const first = node?.errors?.[0];
      message = first ? `${node?.class_type ?? "ComfyUI"}: ${first.message}${first.details ? ` (${first.details})` : ""}` : (body.error?.message ?? message);
    } catch {
      // keep the status
    }
    throw new HttpError(res.status, message, text.slice(0, 800));
  }
  return (await res.json()) as T;
}

/** A photo into ComfyUI's input folder: its name there, for LoadImage. */
async function uploadImage(mime: string, data: string): Promise<string> {
  const form = new FormData();
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  form.append("image", new Blob([Buffer.from(data, "base64")], { type: mime }), `maryx-${crypto.randomUUID()}.${ext}`);
  form.append("type", "input");
  form.append("overwrite", "true");
  const saved = await comfy<{ name: string; subfolder?: string }>("/upload/image", { method: "POST", body: form });
  return saved.subfolder ? `${saved.subfolder}/${saved.name}` : saved.name;
}

/** Queues the picture or clip on the GPU; it's followed with checkComfy. */
export async function startComfy(req: GenerateRequest): Promise<GenerateResult> {
  const photos = req.images ?? [];
  if (req.kind === "image" && photos.length) return { status: "failed", error: "Свой GPU пока рисует только по описанию, без фото." };
  if (req.kind === "video" && photos.length > 1) return { status: "failed", error: "Свой GPU снимает видео по одному фото (первый кадр)." };
  const seed = Math.floor(Math.random() * 2 ** 48);
  let workflow: Workflow;
  if (req.kind === "image") {
    const [width, height] = IMAGE_SIZES[req.aspectRatio] ?? IMAGE_SIZES["1:1"];
    const own = process.env.COMFYUI_IMAGE_WORKFLOW?.trim();
    workflow = own ? ownWorkflow(own, { prompt: req.prompt, negative: "", width, height, seed, frames: 1, image: "" }) : imageWorkflow(req.prompt, width, height, seed);
  } else {
    const [width, height] = VIDEO_SIZES[req.aspectRatio] ?? VIDEO_SIZES["16:9"];
    const frames = Math.min(MAX_FRAMES, Math.round((req.duration ?? 5) * FPS / 4) * 4 + 1);
    const image = photos[0] ? await uploadImage(photos[0].mime, photos[0].data) : undefined;
    const own = process.env.COMFYUI_VIDEO_WORKFLOW?.trim();
    workflow = own
      ? ownWorkflow(own, { prompt: req.prompt, negative: WAN_NEGATIVE, width, height, seed, frames, image: image ?? "" })
      : videoWorkflow(req.prompt, width, height, frames, seed, image);
  }
  const queued = await comfy<{ prompt_id?: string }>("/prompt", { method: "POST", body: JSON.stringify({ prompt: workflow, client_id: "maryx" }) });
  if (!queued.prompt_id) return { status: "failed", error: "ComfyUI не принял задачу." };
  return { status: "pending", jobId: queued.prompt_id };
}

interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: [string, { exception_message?: string; node_type?: string }][] };
  outputs?: Record<string, Record<string, unknown>>;
}

const VIDEO_FILE = /\.(mp4|webm|mkv|mov)$/i;
const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;

/** Where the job is: still queued or running, failed (and why), or its file. */
export async function checkComfy(jobId: string, kind: MediaKind): Promise<GenerateResult> {
  if (!/^[\w-]+$/.test(jobId)) return { status: "failed", error: "Неверный идентификатор задачи." };
  const history = await comfy<Record<string, HistoryEntry>>(`/history/${jobId}`);
  const entry = history[jobId];
  if (!entry) return { status: "pending", jobId };
  if (entry.status?.status_str === "error") {
    const error = entry.status.messages?.find(([type]) => type === "execution_error")?.[1];
    return { status: "failed", error: `Свой GPU не справился${error?.exception_message ? `: ${error.exception_message.trim().slice(0, 300)}` : "."}` };
  }
  if (!entry.status?.completed && entry.status?.status_str !== "success") return { status: "pending", jobId };
  // Every file the workflow saved (SaveImage and SaveVideo both list them under "images"; others under "gifs" or "videos").
  const files = Object.values(entry.outputs ?? {}).flatMap((output) =>
    Object.values(output).flatMap((list) =>
      Array.isArray(list) ? list.filter((f): f is { filename: string; subfolder?: string; type?: string } => typeof f?.filename === "string") : [],
    ),
  );
  const wanted = files.filter((f) => (kind === "video" ? VIDEO_FILE : IMAGE_FILE).test(f.filename) && (f.type ?? "output") === "output");
  if (!wanted.length) return { status: "failed", error: "Свой GPU ничего не сохранил." };
  const outputs: MediaOutput[] = wanted.slice(0, 1).map((f) => ({
    type: "url",
    url: `${comfyBase()}/view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: "output" })}`,
  }));
  return { status: "succeeded", outputs };
}

/** Headers for downloading a result from the GPU server (its token, when it has one). */
export function comfyDownloadHeaders(): Record<string, string> {
  return headers(false);
}
