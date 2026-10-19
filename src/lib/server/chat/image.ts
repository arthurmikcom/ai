// "Draw it right in the chat": generates an image from the user's message
// (or edits the photo they attached) with the best available image model and
// stores it as the answer's attachment. Also how MARYX picks its media models.

import { BRUSH_PREFIX } from "@/lib/effects";
import type { GenerateRequest, GenerateResult, InlineImage, MediaKind, ModelInfo } from "@/lib/types";
import { NotConfiguredError } from "../config";
import type { StoredFile } from "../db/schema";
import { statusOf } from "../errors";
import { checkGeneration, downloadOutput, startGeneration, type OpenRouterCall } from "../media";
import { listModels } from "../models";
import { mediaCost } from "../pricing";
import { deleteFiles, newKey, putFile } from "../storage";

const POLL_EVERY_MS = 2500;
const GIVE_UP_AFTER_MS = 150_000;
/** MARYX tries this many models for one picture or clip, at most. */
const MAX_ATTEMPTS = 3;

/** Image or video models MARYX may use; with the user's own key, only OpenRouter's (which it pays for). */
async function mediaModels(kind: MediaKind, ownKey: boolean, photos = false): Promise<ModelInfo[]> {
  const { models } = await listModels(kind, { ownKey });
  return models.filter((m) => (!ownKey || m.provider === "openrouter") && (!photos || m.photoEdit));
}

/** Whether any image model is set up, so the chat can draw (or, with `photos`, edit a photo). */
export async function canDrawInChat(ownKey = false, photos = false): Promise<boolean> {
  return (await mediaModels("image", ownKey, photos)).length > 0;
}

/** Whether any video model is set up, so the chat can make a clip (with `photos`, from a photo). */
export async function canFilmInChat(ownKey = false, photos = false): Promise<boolean> {
  return (await mediaModels("video", ownKey, photos)).length > 0;
}

/**
 * The models MARYX makes a picture or a clip with (in the chat, and in the
 * studio when it's MARYX's choice), best first: the featured ones among
 * configured providers, then the rest. With `photos`, only models that edit
 * the user's photo.
 */
export async function maryxMediaModels(kind: MediaKind, ownKey = false, photos = false): Promise<ModelInfo[]> {
  const models = await mediaModels(kind, ownKey, photos);
  const ordered = [...models.filter((m) => m.featured), ...models.filter((m) => !m.featured)];
  // A clip from a photo usually shows a real person, which some models refuse: they go last.
  return photos && kind === "video"
    ? [...ordered.filter((m) => !REFUSES_REAL_PEOPLE.test(m.id)), ...ordered.filter((m) => REFUSES_REAL_PEOPLE.test(m.id))]
    : ordered;
}

/** Video models that won't start from a photo of a real person ("…may contain real person"). */
const REFUSES_REAL_PEOPLE = /seedance/i;

/** The provider turned the photo down because a real person is in it. */
export function refusedRealPerson(err: unknown): boolean {
  const e = err as { message?: string; detail?: string } | undefined;
  return /PrivacyInformation|may contain real person|real[_ ]person/i.test(`${e?.message ?? ""} ${e?.detail ?? ""}`);
}

/** The first of maryxMediaModels, or an error saying what to set up. */
export async function maryxMediaModel(kind: MediaKind, ownKey = false, photos = false): Promise<ModelInfo> {
  const pick = (await maryxMediaModels(kind, ownKey, photos))[0];
  if (!pick) {
    throw new NotConfiguredError(
      photos
        ? kind === "image"
          ? "Обработка фото не подключена: нужна модель OpenRouter, которая принимает фото."
          : "Оживление фото не подключено: нужна видеомодель OpenRouter, которая начинает ролик с фото."
        : kind === "image"
          ? "Генерация картинок не подключена: добавьте ключ OpenRouter, OpenAI, Google или Replicate."
          : "Генерация видео не подключена: добавьте ключ OpenRouter, Google или Replicate.",
    );
  }
  return pick;
}

/** The image model a chat draws with (or edits the attached photos with). */
export function chatImageModel(ownKey = false, photos = false): Promise<ModelInfo> {
  return maryxMediaModel("image", ownKey, photos);
}

/**
 * What the image model is told when it edits the user's photo (or a picture
 * made earlier): their words, keeping everything else as it was, and a real
 * photo real unless they ask for a style (the usual ask is a natural retouch).
 */
export function editPrompt(text: string): string {
  // The brush: the second image shows the area to change, painted over in red.
  if (text.trim().startsWith(BRUSH_PREFIX)) {
    return (
      "Edit the first image. The second image is the same picture with the area to change painted over in " +
      "semi-transparent red. Change ONLY that area, as the user asks, and blend it in naturally (light, shadows, " +
      "perspective, texture); everything outside the area must stay exactly as in the first image. The result must " +
      `not contain any red marking. Request for the marked area: ${text.trim().slice(BRUSH_PREFIX.length).trim()}`
    );
  }
  return (
    "Edit the attached image as the user asks. Keep the person's face and identity recognizable, and keep " +
    "everything the user didn't ask to change (age, body shape, pose, clothing, background, framing) as it is. " +
    "Unless the user asks for a style (anime, painting, 3D cartoon and so on), the result must look like a real, " +
    "natural photograph: no plastic skin, no filter look, no objects nobody asked for. If there are several " +
    `images, edit the first one; the others are references. User's request: ${text.trim() || "Natural retouch."}`
  );
}

/**
 * What the video model is told when it animates the user's photo (its first
 * frame): their words, keeping the person and the scene as in the photo.
 */
export function animatePrompt(text: string): string {
  return (
    "Animate this photo into a short, realistic video that starts exactly from it. Keep the person's face, " +
    "identity and the scene as in the photo; natural, physically plausible motion. " +
    (text.trim() || "Subtle natural motion: blinking, breathing, hair and clothes moving in a light breeze, a gentle camera move.")
  );
}

/**
 * What the image model is told for «Мой персонаж»: a new picture of the person
 * in the reference photos, in the scene the user describes, recognizably them.
 */
export function characterPrompt(scene: string): string {
  return (
    "Create a new image of the person shown in the reference photos (they all show the same person), in the scene " +
    "described below. The face must be unmistakably this exact person: keep the face shape, eyes, nose, lips, " +
    "eyebrows, skin tone, hair, age and any distinctive features. Pose, clothing, background, lighting and framing " +
    "follow the scene, not the reference photos. Unless the scene asks for a style (anime, painting, 3D cartoon and so " +
    `on), the result must look like a real, natural photograph with realistic skin. Scene: ${scene.trim()}`
  );
}

/**
 * «Тренд»: the first picture is a frame of someone's video; the main person in
 * it becomes the person of the other pictures, everything else stays.
 */
export function recastPrompt(text: string, plan?: { who: string; first: number; count: number }[]): string {
  if (plan?.length) {
    const swaps = plan.map((p) => `the ${p.who} becomes the person in image${p.count > 1 ? `s ${p.first}–${p.first + p.count - 1}` : ` ${p.first}`}`);
    return (
      `The first image is a frame from a video. Replace these people in it: ${swaps.join("; ")}. Everyone and everything ` +
      "else in the frame stays exactly as it is: framing, camera angle, poses, gestures and body positions, clothing, " +
      "background, cars and objects, lighting, colors and mood. Each new face, hair, skin tone and build must be " +
      "unmistakably the person from their reference image(s), as an adult, natural and photorealistic, as if they had been " +
      `filmed in this scene. ${text.trim() ? `Also: ${text.trim()}` : ""}`
    ).trim();
  }
  return (
    "The first image is a frame from a video. Replace the main person in it with the person shown in the other images " +
    "(they all show the same person). Keep everything else from the first image exactly: framing, camera angle, pose, " +
    "gesture and body position, clothing, background, cars and objects, lighting, colors and mood. The face, hair, skin " +
    "tone and build must be unmistakably the person from the other images, as an adult, natural and photorealistic, as " +
    `if they had been filmed in this scene. ${text.trim() ? `Also: ${text.trim()}` : ""}`
  ).trim();
}

/**
 * What the video model is told for a clip between two frames: it starts
 * exactly on the first photo and ends exactly on the second.
 */
export function transitionPrompt(text: string): string {
  return (
    "Create a smooth, realistic video that starts exactly on the first frame and ends exactly on the last frame, " +
    "with a natural, continuous transformation between them (no cuts, no flashes); keep people's faces recognizable. " +
    (text.trim() || "A seamless cinematic transition with a gentle camera move.")
  );
}

/** The prompt for a picture or a clip made from the user's photos (a clip from two: a transition). */
export function photoPrompt(kind: MediaKind, text: string, photos = 1): string {
  if (kind === "video" && photos >= 2) return transitionPrompt(text);
  return kind === "image" ? editPrompt(text) : animatePrompt(text);
}

/** Errors after which another model may well do it: this one can't take the request, or is down. */
function worthAnotherModel(err: unknown): boolean {
  const status = statusOf(err);
  return status === 400 || status === 404 || status === 422 || (status !== undefined && status >= 500);
}

/** One try at a picture or clip: what came back, or what went wrong, and with which model. */
export interface Attempt {
  model: ModelInfo;
  result?: GenerateResult;
  error?: unknown;
}

/**
 * Starts a picture or clip with MARYX's models in turn: when one refuses the
 * request (it doesn't take a parameter, it's gone, it's down), the next one
 * tries, while there's time. Only models that cost no more than the first are
 * tried, as that's what was held for it.
 */
export async function startWithFallback(
  req: GenerateRequest,
  models: ModelInfo[],
  call: OpenRouterCall,
  until: number,
): Promise<Attempt> {
  const price = (m: ModelInfo) => mediaCost(req.kind, m.id, req.duration);
  const tries = models.filter((m, i) => i === 0 || price(m) <= price(models[0])).slice(0, MAX_ATTEMPTS);
  let attempt: Attempt = { model: tries[0] };
  for (let i = 0; i < tries.length; i++) {
    const model = tries[i];
    const last = i === tries.length - 1 || Date.now() > until;
    try {
      const result = await startGeneration({ ...req, provider: model.provider, model: model.id }, call);
      attempt = { model, result };
      // "No picture came back" is worth another model too; other failures say why on their own.
      if (result.status !== "failed" || last || !/^Модель не вернула/.test(result.error)) return attempt;
    } catch (error) {
      attempt = { model, error };
      // A model that won't take a real person's photo: another one may, even a pricier one.
      if (refusedRealPerson(error) && i === tries.length - 1 && Date.now() <= until) {
        const next = models.find((m) => !tries.includes(m) && !REFUSES_REAL_PEOPLE.test(m.id));
        if (next) tries.push(next);
      }
      if (i === tries.length - 1 || Date.now() > until || !worthAnotherModel(error)) return attempt;
    }
    console.error("[media] trying another model after", model.provider, model.id, attempt.error ?? attempt.result);
  }
  return attempt;
}

/** The provider's full reason for a failed attempt, for the server log and admins. */
export function failureDetail(attempt: Pick<Attempt, "model" | "error">): string {
  const err = attempt.error as { status?: number; message?: string; detail?: string } | undefined;
  const parts = [`${attempt.model.provider}:${attempt.model.id}`, err?.status, err?.message, err?.detail];
  return parts.filter((p) => p !== undefined && p !== "").join(" — ").slice(0, 800);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

/**
 * Draws a picture (or edits the user's `photos`) and stores it, trying
 * MARYX's next model when one refuses. `model` is set as soon as one is
 * tried (also when this throws); `cost` is what the provider reported, if it did.
 */
export async function generateChatImage(
  userId: string,
  prompt: string,
  models: ModelInfo[],
  signal: AbortSignal,
  call: OpenRouterCall = {},
  photos: InlineImage[] = [],
  tried: { model?: ModelInfo } = {},
): Promise<{ files: StoredFile[]; cost?: number; model: ModelInfo }> {
  const started = Date.now();
  const attempt = await startWithFallback(
    {
      kind: "image",
      provider: models[0].provider,
      model: models[0].id,
      prompt: photos.length ? editPrompt(prompt) : prompt,
      aspectRatio: "1:1",
      ...(photos.length ? { images: photos } : {}),
    },
    models,
    call,
    started + 60_000,
  );
  const model = attempt.model;
  tried.model = model;
  if (attempt.error !== undefined) {
    console.error("[chat:image] failed:", failureDetail(attempt));
    throw attempt.error;
  }
  let result = attempt.result!;
  // Most image models answer right away; a few (e.g. on Replicate) run as a job.
  while (result.status === "pending") {
    try {
      if (Date.now() - started > GIVE_UP_AFTER_MS) throw new Error("Картинка рисуется слишком долго. Попробуйте ещё раз.");
      await sleep(POLL_EVERY_MS, signal);
      result = await checkGeneration(model.provider, "image", result.jobId, call);
    } catch (err) {
      // Stopped or given up: the job still runs at the provider, which bills it.
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
        billed: mediaCost("image", model.id),
        reported: false,
      });
    }
  }
  if (result.status === "failed") throw new Error(result.error);

  const files: StoredFile[] = [];
  try {
    for (const output of result.outputs) {
      const { body, mime } = await downloadOutput(model.provider, output, "image", call.key);
      const key = newKey(userId, "attachments", mime);
      await putFile(key, body, mime);
      files.push({ key, mime });
    }
  } catch (err) {
    await deleteFiles(files.map((f) => f.key)).catch(() => {});
    // The provider made (and billed) the picture; only storing it failed.
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      billed: result.cost ?? mediaCost("image", model.id),
      reported: result.cost !== undefined,
    });
  }
  return { files, cost: result.cost, model };
}
