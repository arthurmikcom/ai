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
      // iPadOS reports a desktop "Macintosh" user agent; touch support gives it away.
      const tablet = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
      const weak =
        tablet ||
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
let worker: Worker | null = null;
let loadedId: string | null = null;
/** A model is being downloaded or started right now. */
let loading = false;
let onProgress: ((report: InitProgressReport) => void) | null = null;

/** Drops the engine (and its download, if one is running); the next request starts afresh. */
function resetEngine(): void {
  worker?.terminate();
  worker = null;
  engine = null;
  loadedId = null;
}

/** Loads (or switches to) a model. Only called by the holder of the queue below. */
async function loadModel(id: string): Promise<WebWorkerMLCEngine> {
  loading = true;
  try {
    return await startModel(id);
  } finally {
    loading = false;
  }
}

async function startModel(id: string): Promise<WebWorkerMLCEngine> {
  if (!engine) {
    const webllm = await import("@mlc-ai/web-llm");
    const w = new Worker(new URL("./local-ai.worker.ts", import.meta.url), { type: "module" });
    worker = w;
    // A worker that fails to start would otherwise leave the load hanging forever.
    const failed = new Promise<never>((_, reject) =>
      w.addEventListener("error", (e) => reject(new Error(`Worker: ${e.message || "не запустился"}`)), { once: true }),
    );
    engine = Promise.race([
      webllm.CreateWebWorkerMLCEngine(w, id, { initProgressCallback: (r) => onProgress?.(r) }),
      failed,
    ]);
    loadedId = id;
    try {
      return await engine;
    } catch (err) {
      resetEngine();
      throw err;
    }
  }
  const current = await engine;
  if (loadedId !== id) {
    loadedId = null;
    await current.reload(id);
    loadedId = id;
  }
  return current;
}

/**
 * One browser answer at a time: answers in two chats would share one engine
 * (a stop in one would cut the other; switching models would unload it).
 */
let queue: Promise<void> = Promise.resolve();

async function takeTurn(signal: AbortSignal, onWait: () => void): Promise<() => void> {
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const before = queue;
  queue = before.then(() => mine);
  let waiting = true;
  void before.then(() => (waiting = false));
  await Promise.resolve();
  if (waiting) onWait();
  try {
    await Promise.race([before, abortion(signal)]);
  } catch (err) {
    // Stopped while waiting: pass the turn on as soon as it would have been ours.
    void before.then(release);
    throw err;
  }
  return release;
}

function abortion(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    const fail = () => reject(new DOMException("Остановлено", "AbortError"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
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

/** Rough token count for Qwen: ~3 letters per token, but every digit is a token. */
export function estimateTokens(text: string): number {
  const digits = text.match(/\p{N}/gu)?.length ?? 0;
  const marks = text.match(/[^\p{L}\p{N}\s]/gu)?.length ?? 0;
  return Math.ceil(digits + marks * 0.7 + (text.length - digits - marks) / 3);
}

/** The model's whole context (WebLLM's Qwen builds), answer included. */
const CONTEXT_TOKENS = 4096;
export const MAX_ANSWER_TOKENS = { normal: 1024, deep: 2048 };

/** Keeps the start and the end of a text within about `tokens`. */
function clip(text: string, tokens: number): string {
  if (estimateTokens(text) <= tokens) return text;
  const ratio = text.length / estimateTokens(text);
  const chars = Math.max(200, Math.floor(tokens * ratio));
  return `${text.slice(0, Math.floor(chars * 0.7))}\n…\n${text.slice(-Math.floor(chars * 0.3))}`;
}

/**
 * The conversation for a small context window: the system prompt, then the
 * newest turns that fit (an older turn that only partly fits keeps its end),
 * opening with the user. `cut` tells that the last message itself was shortened.
 */
export function buildMessages(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  deep: boolean,
): { messages: LocalMessage[]; cut: boolean } {
  let left = CONTEXT_TOKENS - MAX_ANSWER_TOKENS[deep ? "deep" : "normal"] - estimateTokens(system) - 150;
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  let cut = false;
  for (let i = history.length - 1; i >= 0 && left > 0; i--) {
    const h = history[i];
    let content = h.content.trim();
    if (!content) continue;
    const size = estimateTokens(content);
    if (size > left) {
      if (turns.length === 0) {
        content = clip(content, left);
        cut = true;
      } else if (left >= 150) {
        // The end of an earlier answer usually matters most for a follow-up ("продолжи").
        const ratio = content.length / size;
        content = `…${content.slice(-Math.floor(left * ratio))}`;
      } else break;
    }
    left -= estimateTokens(content);
    const prev = turns[0];
    if (prev && prev.role === h.role) prev.content = `${content}\n\n${prev.content}`;
    else turns.unshift({ role: h.role, content });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return { messages: [{ role: "system", content: system }, ...turns], cut };
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

/** `brand`: MARYX-only mode, where the model behind MARYX isn't named and can't be picked. */
function friendlyError(err: unknown, brand: boolean): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (/DeviceLost|out of memory|OOM|allocation/i.test(msg)) {
    return brand
      ? "Не хватило памяти видеокарты. Закройте лишние вкладки и попробуйте снова."
      : "Не хватило памяти видеокарты. Выберите модель поменьше (Qwen 3 0.6B) и попробуйте снова.";
  }
  if (/ContextWindowSizeExceeded|context window/i.test(msg)) {
    return "Сообщение слишком длинное для модели в браузере — сократите его.";
  }
  if (/ModelNotLoaded|lost|disposed/i.test(msg)) {
    return "Модель в браузере сбросилась (видеокарта перезапустилась). Попробуйте ещё раз.";
  }
  if (/^Worker:/.test(msg)) return "Не удалось запустить модель в браузере. Обновите страницу и попробуйте снова.";
  if (/fetch|network|Failed to load|NetworkError|404/i.test(msg)) {
    return "Не удалось скачать модель. Проверьте интернет и попробуйте ещё раз.";
  }
  if (/WebGPU|GPU/i.test(msg)) return NO_WEBGPU;
  if (brand) {
    console.error("[local-ai]", err);
    return "MARYX не смог ответить на этом устройстве. Попробуйте ещё раз.";
  }
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
  /** MARYX-only mode: the model is shown as MARYX. */
  brand?: boolean;
}): AsyncGenerator<{ reasoning: string; text: string; truncated: boolean }> {
  const { model, messages, deep, signal, onStatus } = input;
  const brand = input.brand ?? false;
  const label = brand ? "MARYX" : labelOf(model);
  const sizeMB = BROWSER_MODELS.find((m) => m.id === model)?.downloadMB;

  const f = fake();
  if (f) {
    const release = await takeTurn(signal, () => onStatus("Жду, пока модель закончит ответ в другом чате…"));
    try {
      onStatus(`Подключаю ${label}…`);
      await new Promise((r) => setTimeout(r, f.delayMs ?? 30));
      onStatus(undefined);
      const reply = f.reply(messages, { deep });
      let raw = "";
      for (const word of reply.split(/(?<=\s)/)) {
        if (signal.aborted) throw new DOMException("Остановлено", "AbortError");
        raw += word;
        await new Promise((r) => setTimeout(r, f.delayMs ?? 30));
        yield { ...split(raw), truncated: false };
      }
    } finally {
      release();
    }
    return;
  }

  const s = await localSupport();
  if (!s.ok) throw new Error(s.reason ?? NO_WEBGPU);
  const id = `${model}-${s.f16 ? "q4f16_1" : "q4f32_1"}-MLC`;

  const release = await takeTurn(signal, () => onStatus("Жду, пока модель закончит ответ в другом чате…"));
  try {
    onStatus(`Подключаю ${label}…`);
    onProgress = (r) => onStatus(statusText(r, label, sizeMB));
    let eng: WebWorkerMLCEngine;
    try {
      eng = await Promise.race([loadModel(id), abortion(signal)]);
    } catch (err) {
      // Stopped during the download: cancel it (shards already fetched stay cached).
      if (signal.aborted) {
        if (loading) resetEngine();
        throw err;
      }
      resetEngine();
      throw new Error(friendlyError(err, brand));
    } finally {
      onProgress = null;
    }
    onStatus(undefined);
    if (signal.aborted) throw new DOMException("Остановлено", "AbortError");

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
        max_tokens: MAX_ANSWER_TOKENS[deep ? "deep" : "normal"],
        extra_body: { enable_thinking: deep },
      });
      for await (const chunk of stream) {
        // Leaving the loop closes the stream in the worker and frees the model.
        if (signal.aborted) break;
        const choice = chunk.choices[0];
        raw += choice?.delta?.content ?? "";
        if (choice?.finish_reason === "length") truncated = true;
        yield { ...split(raw), truncated };
      }
    } catch (err) {
      if (signal.aborted) throw new DOMException("Остановлено", "AbortError");
      // A lost GPU device unloads the model behind our back: start afresh next time.
      resetEngine();
      throw new Error(friendlyError(err, brand));
    } finally {
      signal.removeEventListener("abort", stop);
    }
    if (signal.aborted) throw new DOMException("Остановлено", "AbortError");
  } finally {
    release();
  }
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
  /** MARYX-only mode: MARYX doesn't name the model it runs on. */
  brand?: boolean;
}): string {
  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const lines = [
    input.assistantPrompt?.slice(0, 1500) ||
      (input.brand
        ? "Ты — MARYX, собственный ИИ платформы MARYX Ai. Сейчас ты работаешь прямо в браузере пользователя, бесплатно."
        : input.maryx
          ? `Ты — MARYX, собственный ИИ платформы MARYX Ai. Сейчас ты работаешь прямо в браузере пользователя на открытой модели ${labelOf(input.model)}: бесплатно, без сторонних ИИ-сервисов.`
          : "Ты — полезный ассистент."),
    ...(input.brand
      ? ["Не называй модели и компании, на которых работаешь. Если спросят, кто ты, отвечай, что ты MARYX — ИИ платформы MARYX Ai."]
      : []),
    "Отвечай на языке пользователя, по делу. Используй Markdown, когда это помогает. Если не уверен — так и скажи, не выдумывай факты.",
    `Сегодня ${date}.`,
  ];
  if (input.about) lines.push("О пользователе:", input.about.slice(0, 600));
  if (input.style) lines.push("Как отвечать:", input.style.slice(0, 600));
  return lines.join("\n");
}
