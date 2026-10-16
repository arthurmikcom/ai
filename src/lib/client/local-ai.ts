"use client";

// Open Qwen models running in the visitor's browser (WebLLM on WebGPU): free,
// no keys, nothing sent to other services. The model is downloaded once and
// kept in the browser's cache; generation happens in a Web Worker.

import { useEffect, useState } from "react";
import type { InitProgressReport, WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { BROWSER_MODELS } from "@/lib/catalog";

export interface LocalSupport {
  ok: boolean;
  /** The GPU has shader-f16, so the smaller q4f16 builds work. */
  f16: boolean;
  /** A phone or a device with little memory: use the smallest model. */
  weak: boolean;
  /** Why it doesn't work here (shown to the user). */
  reason?: string;
}

/** Test seam: Playwright sets this to run the chat flow without a GPU. */
interface FakeLocalAI {
  reply: (messages: LocalMessage[], options: { deep: boolean }) => string;
  delayMs?: number;
}

function fake(): FakeLocalAI | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { __MARYX_FAKE_LOCAL_AI__?: FakeLocalAI }).__MARYX_FAKE_LOCAL_AI__;
}

const NO_WEBGPU =
  "Этот браузер не умеет запускать ИИ на устройстве. Откройте сайт в Chrome, Edge или Яндекс Браузере на компьютере либо в Chrome на Android.";

const NO_GPU =
  "На этом устройстве не нашлась видеокарта для ИИ. Откройте сайт в Chrome, Edge или Яндекс Браузере на компьютере либо в Chrome на Android.";

let support: Promise<LocalSupport> | null = null;

export function localSupport(): Promise<LocalSupport> {
  support ??= (async (): Promise<LocalSupport> => {
    if (fake()) return { ok: true, f16: true, weak: false };
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: (o?: object) => Promise<GPUAdapterLike | null> } }).gpu;
    if (!gpu) return { ok: false, f16: false, weak: true, reason: NO_WEBGPU };
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return { ok: false, f16: false, weak: true, reason: NO_GPU };
      const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
      const weak =
        /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
        (memory !== undefined && memory <= 4) ||
        adapter.limits.maxBufferSize < 1024 ** 3;
      return { ok: true, f16: adapter.features.has("shader-f16"), weak };
    } catch {
      return { ok: false, f16: false, weak: true, reason: NO_WEBGPU };
    }
  })();
  return support;
}

interface GPUAdapterLike {
  features: { has: (name: string) => boolean };
  limits: { maxBufferSize: number };
}

/** What this browser can run, or null while it's being checked. */
export function useLocalSupport(): LocalSupport | null {
  const [state, setState] = useState<LocalSupport | null>(null);
  useEffect(() => {
    let alive = true;
    void localSupport().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** The browser model MARYX uses on this device. */
export function autoModel(s: LocalSupport | null): string {
  return s?.weak ? "Qwen3-0.6B" : "Qwen3-1.7B";
}

function labelOf(model: string): string {
  return BROWSER_MODELS.find((m) => m.id === model)?.label ?? model;
}

// ---------- Engine ----------

let engine: Promise<WebWorkerMLCEngine> | null = null;
let loadedId: string | null = null;
let chain: Promise<unknown> = Promise.resolve();
let onProgress: ((report: InitProgressReport) => void) | null = null;

/** Loads (or switches to) a model; one load at a time. */
function ensureModel(id: string): Promise<WebWorkerMLCEngine> {
  const job = chain.then(async () => {
    if (!engine) {
      const webllm = await import("@mlc-ai/web-llm");
      const worker = new Worker(new URL("./local-ai.worker.ts", import.meta.url), { type: "module" });
      engine = webllm
        .CreateWebWorkerMLCEngine(worker, id, { initProgressCallback: (r) => onProgress?.(r) })
        .catch((err) => {
          worker.terminate();
          engine = null;
          loadedId = null;
          throw err;
        });
      loadedId = id;
      return engine;
    }
    const current = await engine;
    if (loadedId !== id) {
      loadedId = null;
      await current.reload(id);
      loadedId = id;
    }
    return current;
  });
  chain = job.catch(() => {});
  return job;
}

/** Russian status text for WebLLM's per-phase progress. */
function statusText(r: InitProgressReport, label: string, sizeMB?: number): string {
  const pct = Math.round(r.progress * 100);
  if (r.text.startsWith("Fetching param cache")) {
    return `Скачиваю ${label}: ${pct}%${sizeMB ? ` из ≈${sizeMB >= 1000 ? `${(sizeMB / 1000).toFixed(1).replace(".", ",")} ГБ` : `${sizeMB} МБ`}` : ""} — только в первый раз`;
  }
  if (r.text.startsWith("Loading model from cache")) return `Загружаю ${label} в память: ${pct}%`;
  if (r.text.startsWith("Loading GPU shader")) return `Готовлю видеокарту: ${pct}%`;
  if (r.text.startsWith("Finish loading")) return "Модель готова";
  return `Подключаю ${label}…`;
}

// ---------- Messages ----------

export interface LocalMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * The conversation for a small context window (4096 tokens, answer included):
 * the system prompt, then the newest turns that fit, opening with the user.
 */
export function buildMessages(system: string, history: { role: "user" | "assistant"; content: string }[], deep: boolean): LocalMessage[] {
  const budget = deep ? 3500 : 6000;
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    let content = h.content.trim();
    if (!content) continue;
    if (i === history.length - 1 && content.length > budget) content = `${content.slice(0, budget - 300)}\n…\n${content.slice(-300)}`;
    if (used + content.length > budget && turns.length) break;
    used += content.length;
    const prev = turns[0];
    if (prev && prev.role === h.role) prev.content = `${content}\n\n${prev.content}`;
    else turns.unshift({ role: h.role, content });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return [{ role: "system", content: system }, ...turns];
}

/** Reasoning and answer from the raw stream (Qwen writes its thinking in <think> tags). */
function split(raw: string): { reasoning: string; text: string } {
  const t = raw.replace(/^\s+/, "");
  if ("<think>".startsWith(t)) return { reasoning: "", text: "" };
  const body = t.startsWith("<think>") ? t.slice(7) : t;
  const end = body.indexOf("</think>");
  if (end >= 0) return { reasoning: body.slice(0, end).trim(), text: body.slice(end + 8).replace(/^\s+/, "") };
  return t.startsWith("<think>") ? { reasoning: body.trim(), text: "" } : { reasoning: "", text: t };
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (/DeviceLost|out of memory|OOM|allocation/i.test(msg)) {
    return "Не хватило памяти видеокарты. Выберите модель поменьше (Qwen 3 0.6B) и попробуйте снова.";
  }
  if (/ContextWindowSizeExceeded|context window/i.test(msg)) {
    return "Диалог стал слишком длинным для модели в браузере — начните новый чат.";
  }
  if (/fetch|network|Failed to load|NetworkError|404/i.test(msg)) {
    return "Не удалось скачать модель. Проверьте интернет и попробуйте ещё раз.";
  }
  if (/WebGPU|GPU/i.test(msg)) return NO_WEBGPU;
  return `Модель в браузере не смогла ответить: ${err instanceof Error ? err.message : msg}`;
}

/**
 * Streams an answer from a browser model. Yields the whole answer so far each
 * time; `status` reports the download and start-up. Throws a user-facing
 * Error on failure, or an AbortError when `signal` fires.
 */
export async function* generateLocal(input: {
  model: string;
  messages: LocalMessage[];
  deep: boolean;
  signal: AbortSignal;
  onStatus: (status: string | undefined) => void;
}): AsyncGenerator<{ reasoning: string; text: string; truncated: boolean }> {
  const { model, messages, deep, signal, onStatus } = input;
  const aborted = () => new DOMException("Остановлено", "AbortError");
  const label = labelOf(model);
  const sizeMB = BROWSER_MODELS.find((m) => m.id === model)?.downloadMB;

  const f = fake();
  if (f) {
    onStatus(`Подключаю ${label}…`);
    await new Promise((r) => setTimeout(r, f.delayMs ?? 30));
    onStatus(undefined);
    const reply = f.reply(messages, { deep });
    let raw = "";
    for (const word of reply.split(/(?<=\s)/)) {
      if (signal.aborted) throw aborted();
      raw += word;
      await new Promise((r) => setTimeout(r, f.delayMs ?? 30));
      yield { ...split(raw), truncated: false };
    }
    return;
  }

  const s = await localSupport();
  if (!s.ok) throw new Error(s.reason ?? NO_WEBGPU);
  const id = `${model}-${s.f16 ? "q4f16_1" : "q4f32_1"}-MLC`;

  onStatus(`Подключаю ${label}…`);
  onProgress = (r) => onStatus(statusText(r, label, sizeMB));
  let eng: WebWorkerMLCEngine;
  try {
    // The download can't be cancelled, but the user doesn't have to wait for it.
    eng = await Promise.race([
      ensureModel(id),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(aborted());
        signal.addEventListener("abort", () => reject(aborted()), { once: true });
      }),
    ]);
  } catch (err) {
    if (signal.aborted) throw aborted();
    throw new Error(friendlyError(err));
  } finally {
    onProgress = null;
  }
  onStatus(undefined);
  if (signal.aborted) throw aborted();

  const stop = () => eng.interruptGenerate();
  signal.addEventListener("abort", stop);
  let raw = "";
  let truncated = false;
  try {
    const stream = await eng.chat.completions.create({
      messages,
      stream: true,
      temperature: deep ? 0.6 : 0.7,
      top_p: deep ? 0.95 : 0.8,
      max_tokens: deep ? 2048 : 1024,
      extra_body: { enable_thinking: deep },
    });
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      raw += choice?.delta?.content ?? "";
      if (choice?.finish_reason === "length") truncated = true;
      yield { ...split(raw), truncated };
    }
  } catch (err) {
    if (signal.aborted) throw aborted();
    throw new Error(friendlyError(err));
  } finally {
    signal.removeEventListener("abort", stop);
  }
  if (signal.aborted) throw aborted();
}

// ---------- Prompt ----------

let instructions: Promise<{ about: string; style: string }> | null = null;

/** The user's personal instructions (Settings), loaded once per page. */
export function personalInstructions(): Promise<{ about: string; style: string }> {
  instructions ??= fetch("/api/instructions")
    .then((r) => (r.ok ? r.json() : { about: "", style: "" }))
    .catch(() => ({ about: "", style: "" }));
  return instructions;
}

/** Drops the cached instructions after they're edited in Settings. */
export function forgetInstructions(): void {
  instructions = null;
}

/** A short system prompt: small models have a small context. */
export function localSystemPrompt(input: {
  model: string;
  maryx: boolean;
  assistantPrompt?: string;
  about: string;
  style: string;
}): string {
  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const lines = [
    input.assistantPrompt?.slice(0, 1500) ||
      (input.maryx
        ? `Ты — MARYX, собственный ИИ платформы MARYX Ai. Сейчас ты работаешь прямо в браузере пользователя на открытой модели ${labelOf(input.model)}: бесплатно, сообщения никуда не отправляются.`
        : "Ты — полезный ассистент."),
    "Отвечай на языке пользователя, по делу. Используй Markdown, когда это помогает. Если не уверен — так и скажи, не выдумывай факты.",
    `Сегодня ${date}.`,
  ];
  if (input.about) lines.push("О пользователе:", input.about.slice(0, 600));
  if (input.style) lines.push("Как отвечать:", input.style.slice(0, 600));
  return lines.join("\n");
}
