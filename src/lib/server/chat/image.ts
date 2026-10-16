// "Draw it right in the chat": generates an image from the user's message
// with the best available image model and stores it as the answer's attachment.

import type { ModelInfo } from "@/lib/types";
import { NotConfiguredError } from "../config";
import type { StoredFile } from "../db/schema";
import { checkGeneration, downloadOutput, startGeneration, type OpenRouterCall } from "../media";
import { listModels } from "../models";
import { deleteFiles, newKey, putFile } from "../storage";

const POLL_EVERY_MS = 2500;
const GIVE_UP_AFTER_MS = 150_000;

/** Image models a chat may use; with the user's own key, only OpenRouter's (which it pays for). */
async function imageModels(ownKey: boolean): Promise<ModelInfo[]> {
  const { models } = await listModels("image", { ownKey });
  return ownKey ? models.filter((m) => m.provider === "openrouter") : models;
}

/** Whether any image model is set up, so the chat can draw. */
export async function canDrawInChat(ownKey = false): Promise<boolean> {
  return (await imageModels(ownKey)).length > 0;
}

/** The image model a chat uses: the first featured one among configured providers. */
export async function chatImageModel(ownKey = false): Promise<ModelInfo> {
  const models = await imageModels(ownKey);
  const pick = models.find((m) => m.featured) ?? models[0];
  if (!pick) {
    throw new NotConfiguredError(
      "Генерация картинок не подключена: добавьте ключ OpenRouter, OpenAI, Google или Replicate.",
    );
  }
  return pick;
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

/** Draws a picture and stores it; `cost` is what the provider reported, if it did. */
export async function generateChatImage(
  userId: string,
  prompt: string,
  model: ModelInfo,
  signal: AbortSignal,
  call: OpenRouterCall = {},
): Promise<{ files: StoredFile[]; cost?: number }> {
  const started = Date.now();
  let result = await startGeneration(
    {
      kind: "image",
      provider: model.provider,
      model: model.id,
      prompt,
      aspectRatio: "1:1",
    },
    call,
  );
  // Most image models answer right away; a few (e.g. on Replicate) run as a job.
  while (result.status === "pending") {
    if (Date.now() - started > GIVE_UP_AFTER_MS) throw new Error("Картинка рисуется слишком долго. Попробуйте ещё раз.");
    await sleep(POLL_EVERY_MS, signal);
    result = await checkGeneration(model.provider, "image", result.jobId, call);
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
    throw err;
  }
  return { files, cost: result.cost };
}
