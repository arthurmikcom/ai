// Speech-to-text for dictation. The browser records a short clip; the server
// turns it into text through OpenRouter (or OpenAI directly). This works in
// every browser, unlike the Web Speech API, which needs Google's servers.

import { toFile } from "openai";
import { isConfigured, NotConfiguredError, openAIClient, openRouterBase, requireKey } from "./config";
import { HttpError } from "./errors";

/** Audio container → the format name the transcription APIs expect. */
function formatOf(mime: string): "webm" | "m4a" | "ogg" | "mp3" | "wav" {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  return "wav";
}

export function transcriptionAvailable(): boolean {
  return isConfigured("openrouter") || isConfigured("openai");
}

/** Models tried in order; the first may not be offered to every account. */
function openRouterModels(): string[] {
  const preferred = process.env.STT_MODEL?.trim();
  return [...new Set([preferred || "openai/gpt-4o-mini-transcribe", "openai/whisper-1"])];
}

async function viaOpenRouter(audio: Buffer, mime: string): Promise<string> {
  let lastError: unknown;
  for (const model of openRouterModels()) {
    const res = await fetch(`${openRouterBase()}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireKey("openrouter")}`,
        "Content-Type": "application/json",
        "X-Title": "Nexus AI",
      },
      body: JSON.stringify({ model, input_audio: { data: audio.toString("base64"), format: formatOf(mime) } }),
    });
    if (res.ok) return ((await res.json()) as { text?: string }).text ?? "";
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    lastError = new HttpError(res.status, detail?.error?.message ?? res.statusText);
    // Try the next model only when this one isn't available; other errors are final.
    if (res.status !== 404 && res.status !== 400) break;
  }
  throw lastError;
}

async function viaOpenAI(audio: Buffer, mime: string): Promise<string> {
  const file = await toFile(audio, `voice.${formatOf(mime)}`, { type: mime });
  const res = await openAIClient("openai").audio.transcriptions.create({ file, model: "gpt-4o-mini-transcribe" });
  return res.text;
}

export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  if (isConfigured("openrouter")) return (await viaOpenRouter(audio, mime)).trim();
  if (isConfigured("openai")) return (await viaOpenAI(audio, mime)).trim();
  throw new NotConfiguredError("Голосовой ввод не подключён: нужен ключ OpenRouter или OpenAI.");
}
