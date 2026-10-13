import { FEATURED_MODELS, PROVIDERS } from "@/lib/catalog";
import type { Capability, ModelInfo, ModelsResponse, ProviderId } from "@/lib/types";
import { ADAPTIVE_THINKING } from "./chat/anthropic";
import { THINKING_LEVEL_MODELS } from "./chat/google";
import { OPENAI_REASONING } from "./chat/openai-compatible";
import {
  anthropicClient,
  apiKey,
  googleClient,
  isConfigured,
  isOpenAICompatible,
  openAIClient,
} from "./config";

interface LiveModel {
  id: string;
  name?: string;
  /** Google only: which API methods the model supports. */
  actions?: string[];
}

const TTL_MS = 10 * 60 * 1000;
const LIVE_TIMEOUT_MS = 8000;
const cache = new Map<ProviderId, { at: number; models: Promise<LiveModel[] | null> }>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function collect<T>(iterable: AsyncIterable<T>, limit = 2000): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchLive(provider: ProviderId): Promise<LiveModel[] | null> {
  if (provider === "anthropic") {
    const models = await collect(anthropicClient().models.list({ limit: 100 }));
    return models.map((m) => ({ id: m.id, name: m.display_name }));
  }
  if (provider === "google") {
    const pager = await googleClient().models.list({ config: { pageSize: 1000 } });
    const models = await collect(pager);
    return models
      .filter((m) => m.name)
      .map((m) => ({
        id: m.name!.replace(/^models\//, ""),
        name: m.displayName,
        actions: m.supportedActions,
      }));
  }
  if (provider === "replicate") {
    // Replicate hosts thousands of models, so rather than listing them we just
    // confirm that each featured one still exists.
    const token = apiKey("replicate");
    const featured = FEATURED_MODELS.filter((m) => m.provider === "replicate");
    const checks = await Promise.all(
      featured.map(async (m) => {
        const res = await fetch(`https://api.replicate.com/v1/models/${m.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return res.status === 404 ? null : { id: m.id };
      }),
    );
    return checks.filter((m): m is LiveModel => m !== null);
  }
  if (isOpenAICompatible(provider)) {
    const models = await collect(openAIClient(provider).models.list());
    return models.map((m) => ({ id: m.id }));
  }
  return null;
}

/** Live model list for a provider, or null when it can't be fetched. */
function liveModels(provider: ProviderId): Promise<LiveModel[] | null> {
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;
  const models = withTimeout(fetchLive(provider), LIVE_TIMEOUT_MS).catch(() => null);
  cache.set(provider, { at: Date.now(), models });
  return models;
}

const OPENAI_NOT_CHAT =
  /(audio|realtime|tts|transcribe|image|search|embed|instruct|codex|live|translate|moderation|sora|dall-e|whisper|babbage|davinci)/;
const GOOGLE_NOT_CHAT =
  /(image|tts|embed|robotics|lyria|veo|imagen|aqa|live|native-audio|computer-use|learnlm)/;

/** Which capability a live (non-featured) model belongs to, if any. */
function classify(provider: ProviderId, m: LiveModel): Capability | null {
  const id = m.id.toLowerCase();
  switch (provider) {
    case "anthropic":
      return "chat";
    case "openai":
      if (/^(gpt-image|dall-e|chatgpt-image)/.test(id)) return "image";
      if (/^(gpt-|o\d|chatgpt-)/.test(id) && !OPENAI_NOT_CHAT.test(id)) return "chat";
      return null;
    case "google":
      if (id.includes("veo")) return "video";
      if (id.includes("imagen") || /-image($|-)/.test(id) || id.includes("nano-banana")) {
        return "image";
      }
      if (m.actions?.includes("generateContent") && !GOOGLE_NOT_CHAT.test(id)) return "chat";
      return null;
    case "xai":
      return /(image|imagine|video)/.test(id) ? null : "chat";
    case "openrouter":
    case "deepseek":
    case "ollama":
      return "chat";
    case "replicate":
      return null;
  }
}

function liveModelInfo(provider: ProviderId, capability: Capability, m: LiveModel): ModelInfo {
  const id = m.id;
  return {
    id,
    provider,
    label: m.name || id,
    capability,
    featured: false,
    vision: provider === "anthropic" || provider === "google" ? true : undefined,
    reasoning:
      (provider === "anthropic" && ADAPTIVE_THINKING.test(id)) ||
      (provider === "openai" && OPENAI_REASONING.test(id)) ||
      (provider === "google" && THINKING_LEVEL_MODELS.test(id)),
  };
}

async function modelsFor(provider: ProviderId, capability: Capability): Promise<ModelInfo[]> {
  const featured = FEATURED_MODELS.filter(
    (m) => m.provider === provider && m.capability === capability,
  );
  const live = await liveModels(provider);

  // Provider unreachable: trust the curated list.
  if (live === null) return featured.map((m) => ({ ...m, featured: true }));

  const liveIds = new Set(live.map((m) => m.id));
  const result: ModelInfo[] = featured
    .filter((m) => liveIds.has(m.id))
    .map((m) => ({ ...m, featured: true }));
  const featuredIds = new Set(featured.map((m) => m.id));

  const others = live
    .filter((m) => !featuredIds.has(m.id) && classify(provider, m) === capability)
    .map((m) => liveModelInfo(provider, capability, m))
    .sort((a, b) => a.id.localeCompare(b.id));

  // If none of our picks survived (e.g. a provider renamed everything),
  // promote a few live models so the provider still has something on top.
  if (result.length === 0) others.slice(0, 5).forEach((m) => (m.featured = true));
  return [...result, ...others];
}

export async function listModels(capability: Capability | null): Promise<ModelsResponse> {
  const providers = PROVIDERS.map((p) => ({ ...p, configured: isConfigured(p.id) }));
  const capabilities: Capability[] = capability ? [capability] : ["chat", "image", "video"];

  const jobs = providers
    .filter((p) => p.configured)
    .flatMap((p) =>
      capabilities
        .filter((c) => p.capabilities.includes(c))
        .map((c) => modelsFor(p.id, c)),
    );
  const models = (await Promise.all(jobs)).flat();
  return { providers, models };
}
