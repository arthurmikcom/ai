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
    case "ollama":
      return undefined;
  }
}

export function isConfigured(provider: ProviderId): boolean {
  if (provider === "ollama") return Boolean(env("OLLAMA_BASE_URL"));
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

/** OpenRouter API root; OPENROUTER_BASE_URL points it at a local mock for testing. */
export function openRouterBase(): string {
  return (env("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}

const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<ProviderId, string>> = {
  deepseek: "https://api.deepseek.com",
  xai: "https://api.x.ai/v1",
};

export function isOpenAICompatible(provider: ProviderId): boolean {
  return (
    provider === "openai" ||
    provider === "ollama" ||
    provider === "openrouter" ||
    provider in OPENAI_COMPATIBLE_BASE_URLS
  );
}

/** OpenAI itself plus every provider that speaks the OpenAI wire format. */
export function openAIClient(provider: ProviderId): OpenAI {
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
  return new OpenAI({
    apiKey: requireKey(provider),
    baseURL: provider === "openrouter" ? openRouterBase() : OPENAI_COMPATIBLE_BASE_URLS[provider],
    defaultHeaders:
      provider === "openrouter"
        ? { "X-Title": "Nexus AI" }
        : undefined,
  });
}
