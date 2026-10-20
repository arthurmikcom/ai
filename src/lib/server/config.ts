import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { PROVIDERS } from "@/lib/catalog";
import type { ProviderId } from "@/lib/types";

/** Thrown when a request needs a provider whose key is missing. */
export class NotConfiguredError extends Error {}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Users see and use only our own AI, MARYX — no model picker and no names of
 * the models and providers behind it (admin screens aside). SHOW_ALL_MODELS=true
 * brings back the choice of every model.
 */
export function maryxOnly(): boolean {
  return env("SHOW_ALL_MODELS")?.toLowerCase() !== "true";
}

export function apiKey(provider: ProviderId): string | undefined {
  switch (provider) {
    case "anthropic":
      return env("ANTHROPIC_API_KEY");
    case "openai":
      return env("OPENAI_API_KEY");
    case "google":
      return env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY");
    case "openrouter":
      return env("OPENROUTER_API_KEY");
    case "deepseek":
      return env("DEEPSEEK_API_KEY");
    case "xai":
      return env("XAI_API_KEY");
    case "replicate":
      return env("REPLICATE_API_TOKEN");
    case "higgsfield": {
      // Higgsfield's key is a pair, sent as "ID:SECRET" (or given so in one variable).
      const id = env("HF_API_KEY_ID") ?? env("HF_API_KEY");
      const secret = env("HF_API_KEY_SECRET") ?? env("HF_API_SECRET");
      if (id && secret) return `${id}:${secret}`;
      return env("HF_KEY") ?? env("HIGGSFIELD_API_KEY");
    }
    case "qwen":
      return env("DASHSCOPE_API_KEY");
    case "custom":
      // vLLM and others accept requests without a key unless started with --api-key.
      return env("CUSTOM_LLM_API_KEY");
    case "comfy":
      // ComfyUI itself has no keys; a token only when it sits behind a proxy that asks for one.
      return env("COMFYUI_TOKEN");
    case "pollinations":
      // Works without one; a token (from pollinations.ai) only raises its limits.
      return env("POLLINATIONS_TOKEN");
    case "ollama":
    case "maryx":
    case "browser":
      return undefined;
  }
}

export function isConfigured(provider: ProviderId): boolean {
  if (provider === "ollama") return Boolean(env("OLLAMA_BASE_URL"));
  if (provider === "custom") return Boolean(env("CUSTOM_LLM_BASE_URL"));
  if (provider === "comfy") return Boolean(env("COMFYUI_URL"));
  // Keyless: on unless turned off.
  if (provider === "pollinations") return env("POLLINATIONS_URL")?.toLowerCase() !== "off";
  return Boolean(apiKey(provider));
}

export function requireKey(provider: ProviderId): string {
  const key = apiKey(provider);
  if (!key) {
    const def = PROVIDERS.find((p) => p.id === provider);
    throw new NotConfiguredError(
      `${def?.name ?? provider} не подключён: добавьте ${def?.envVar} в файл .env.local и перезапустите сервер.`,
    );
  }
  return key;
}

export function anthropicClient(): Anthropic {
  return new Anthropic({ apiKey: requireKey("anthropic") });
}

export function googleClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: requireKey("google") });
}

/** The key for an OpenRouter call: the user's own (BYOK) when given, else the server's. */
export function openRouterKey(own?: string): string {
  return own || requireKey("openrouter");
}

/** OpenRouter API root; OPENROUTER_BASE_URL points it at a local mock for testing. */
/** The quality «Точный повтор» is made in (HIGGSFIELD_RESOLUTION): 480p is cheaper, 1080p sharper; 720p by default. */
export function motionResolution(): "480p" | "720p" | "1080p" {
  const value = env("HIGGSFIELD_RESOLUTION")?.toLowerCase();
  return value === "480p" || value === "1080p" ? value : "720p";
}

/** The site's own GPU server running ComfyUI (COMFYUI_URL), e.g. a home PC behind a tunnel or a rented GPU. */
export function comfyBase(): string {
  return (env("COMFYUI_URL") ?? "").replace(/\/+$/, "");
}

/**
 * Where Pollinations draws: the prompt goes after it (POLLINATIONS_URL points
 * it elsewhere, e.g. a local mock in tests). Without a token, its old keyless
 * address; with POLLINATIONS_TOKEN, its current one (which asks for a key).
 */
export function pollinationsBase(): string {
  const fallback = env("POLLINATIONS_TOKEN") ? "https://gen.pollinations.ai/image" : "https://image.pollinations.ai/prompt";
  return (env("POLLINATIONS_URL") ?? fallback).replace(/\/+$/, "");
}

/**
 * What the free plan draws with (FREE_PLAN_IMAGES): "free" — the free open
 * models (the site's own GPU, else Pollinations), no fee per picture, and
 * credits never spent on them; "gpt" — GPT Image within the plan's budget.
 */
export function freePlanFreeImages(): boolean {
  return env("FREE_PLAN_IMAGES")?.toLowerCase() !== "gpt";
}

/** Credits every new account gets as a gift (WELCOME_CREDITS, default 50; 0 turns it off). */
export function welcomeCredits(): number {
  const n = Number.parseInt(env("WELCOME_CREDITS") ?? "", 10);
  return Number.isFinite(n) && n >= 0 && n <= 100_000 ? n : 50;
}

/**
 * Photo edits a day on the free plan (FREE_DAILY_PHOTO_EDITS, default 2; 0
 * turns them off). The free plan's own model only draws from words, so these
 * are made like a paid plan's — within the free plan's monthly budget for
 * pictures and the site's daily budget.
 */
export function freePhotoEdits(): number {
  const n = Number.parseInt(env("FREE_DAILY_PHOTO_EDITS") ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

/** Higgsfield's API (HIGGSFIELD_BASE_URL points it elsewhere, e.g. a local mock in tests). */
export function higgsfieldBase(): string {
  return (env("HIGGSFIELD_BASE_URL") ?? "https://api.higgsfield.ai").replace(/\/+$/, "");
}

export function openRouterBase(): string {
  return (env("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}

const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<ProviderId, string>> = {
  deepseek: "https://api.deepseek.com",
  xai: "https://api.x.ai/v1",
};

/**
 * Qwen's OpenAI-compatible API. Keys belong to one region: Singapore by default;
 * DASHSCOPE_BASE_URL picks another (US: https://dashscope-us.aliyuncs.com/compatible-mode/v1,
 * Beijing: https://dashscope.aliyuncs.com/compatible-mode/v1).
 */
function qwenBase(): string {
  return (env("DASHSCOPE_BASE_URL") ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, "");
}

export function isOpenAICompatible(provider: ProviderId): boolean {
  return (
    provider === "openai" ||
    provider === "ollama" ||
    provider === "openrouter" ||
    provider === "qwen" ||
    provider === "custom" ||
    provider in OPENAI_COMPATIBLE_BASE_URLS
  );
}

/**
 * OpenAI itself plus every provider that speaks the OpenAI wire format.
 * `key` is a user's own OpenRouter key (BYOK), used instead of the server's.
 */
export function openAIClient(provider: ProviderId, key?: string): OpenAI {
  if (provider === "ollama") {
    const base = env("OLLAMA_BASE_URL");
    if (!base) {
      throw new NotConfiguredError(
        "Ollama не подключена: укажите OLLAMA_BASE_URL (например http://localhost:11434) в .env.local.",
      );
    }
    // Ollama ignores the key, but the SDK requires a non-empty one.
    return new OpenAI({ apiKey: "ollama", baseURL: `${base.replace(/\/+$/, "")}/v1` });
  }
  if (provider === "custom") {
    const base = env("CUSTOM_LLM_BASE_URL");
    if (!base) {
      throw new NotConfiguredError(
        "Свой сервер моделей не подключён: укажите CUSTOM_LLM_BASE_URL (например https://ваш-адрес/v1).",
      );
    }
    return new OpenAI({ apiKey: apiKey("custom") ?? "none", baseURL: base.replace(/\/+$/, "") });
  }
  return new OpenAI({
    apiKey: provider === "openrouter" && key ? key : requireKey(provider),
    baseURL:
      provider === "openrouter" ? openRouterBase() : provider === "qwen" ? qwenBase() : OPENAI_COMPATIBLE_BASE_URLS[provider],
    defaultHeaders:
      provider === "openrouter"
        ? { "X-Title": "MARYX Ai" }
        : undefined,
  });
}
