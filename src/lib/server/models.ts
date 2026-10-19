import { BROWSER_MODELS, FEATURED_MODELS, MARYX_MODEL, PROVIDERS } from "@/lib/catalog";
import type { Capability, ModelInfo, ModelsResponse, ProviderId } from "@/lib/types";
import { ADAPTIVE_THINKING } from "./chat/anthropic";
import { THINKING_LEVEL_MODELS } from "./chat/google";
import { reasoningListLoaded, rememberReasoning } from "./chat/reasoning";
import { rememberPrice } from "./pricing";
import { OPENAI_REASONING } from "./chat/openai-compatible";
import {
  anthropicClient,
  apiKey,
  googleClient,
  isConfigured,
  isOpenAICompatible,
  openAIClient,
  openRouterBase,
} from "./config";

interface LiveModel {
  id: string;
  name?: string;
  /** Google only: which API methods the model supports. */
  actions?: string[];
  /** OpenRouter lists each kind separately, so it knows. */
  capability?: Capability;
  vision?: boolean;
  reasoning?: boolean;
  /** Image models: takes a reference photo to edit; video models: starts from the user's photo. */
  photoEdit?: boolean;
  /** Video models: can also end on a given picture (a transition between two frames). */
  lastFrame?: boolean;
}

/** One entry of OpenRouter's model lists (/models, /images/models, /videos/models). */
interface OpenRouterModel {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[] | Record<string, unknown>;
  /** USD per token, as strings. */
  pricing?: { prompt?: string; completion?: string };
  top_provider?: { max_completion_tokens?: number | null };
  /** Video models: what the model takes (/videos/models). */
  supported_aspect_ratios?: unknown;
  supported_durations?: unknown;
  supported_frame_images?: unknown;
  reasoning?: {
    mandatory?: boolean;
    default_enabled?: boolean;
    default_effort?: string | null;
    supported_efforts?: string[] | null;
  } | null;
}

const TTL_MS = 10 * 60 * 1000;
const LIVE_TIMEOUT_MS = 8000;
/** A healthy self-hosted server answers at once; a stopped GPU server shouldn't hold chats up. */
const SELF_HOSTED_TIMEOUT_MS = 2500;
/** A failed list is retried this soon (instead of after the full TTL) when there's no older one. */
const RETRY_FAILED_MS = 30_000;
const cache = new Map<string, { at: number; models: Promise<LiveModel[] | null>; last?: LiveModel[] }>();
/** What each OpenRouter image model accepts (its supported_parameters), from the last image list. */
const imageParams = new Map<string, Record<string, unknown>>();

/** What an OpenRouter video model takes, from the last video list; a list left out is unknown. */
export interface VideoCaps {
  aspectRatios?: string[];
  durations?: number[];
  /** "first_frame", "last_frame": which frames it can start (or end) from. */
  frameImages?: string[];
}
const videoCaps = new Map<string, VideoCaps>();

/** What an OpenRouter video model takes, or undefined before the list has loaded. */
export function openRouterVideoCaps(id: string): VideoCaps | undefined {
  return videoCaps.get(id);
}

const listOf = <T>(value: unknown, type: "string" | "number"): T[] | undefined =>
  Array.isArray(value) ? (value.filter((v) => typeof v === type) as T[]) : undefined;

/**
 * The parameters an OpenRouter image model accepts, e.g. { aspect_ratio:
 * { type: "enum", values: [...] }, input_references: { type: "range", max: 4 } },
 * or undefined when the list hasn't loaded (then the request trusts the defaults).
 */
export function openRouterImageParams(id: string): Record<string, unknown> | undefined {
  return imageParams.get(id);
}

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

async function openRouterList(capability: Capability): Promise<LiveModel[]> {
  const path = capability === "chat" ? "/models" : `/${capability === "image" ? "images" : "videos"}/models`;
  // The lists are public; the key only matters when the site has one (users with their own key also get them).
  const key = apiKey("openrouter");
  const res = await fetch(`${openRouterBase()}${path}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) throw new Error(`OpenRouter ${path}: HTTP ${res.status}`);
  const { data } = (await res.json()) as { data?: OpenRouterModel[] };
  if (capability === "chat") {
    for (const m of data ?? []) {
      if (typeof m.id !== "string") continue;
      const input = Number.parseFloat(m.pricing?.prompt ?? "");
      const output = Number.parseFloat(m.pricing?.completion ?? "");
      const limit = m.top_provider?.max_completion_tokens;
      if (input >= 0 && output >= 0) rememberPrice(m.id, { input, output }, typeof limit === "number" && limit > 0 ? limit : undefined);
      if (!m.reasoning) continue;
      rememberReasoning(m.id, {
        mandatory: m.reasoning.mandatory === true,
        defaultEnabled: m.reasoning.default_enabled === true,
        defaultEffort: m.reasoning.default_effort ?? undefined,
        efforts: Array.isArray(m.reasoning.supported_efforts) ? m.reasoning.supported_efforts : null,
      });
    }
  }
  // The image and video lists describe each parameter: { aspect_ratio: { type: "enum", values } }.
  const described = (m: OpenRouterModel) =>
    m.supported_parameters && !Array.isArray(m.supported_parameters) && typeof m.supported_parameters === "object"
      ? m.supported_parameters
      : undefined;
  if (capability === "image") {
    for (const m of data ?? []) {
      const params = described(m);
      if (typeof m.id === "string" && params) imageParams.set(m.id, params);
    }
  }
  // The video list names what each model takes: { supported_aspect_ratios: ["16:9", …], … }.
  const frames = (m: OpenRouterModel) => listOf<string>(m.supported_frame_images, "string");
  if (capability === "video") {
    for (const m of data ?? []) {
      if (typeof m.id !== "string") continue;
      videoCaps.set(m.id, {
        aspectRatios: listOf<string>(m.supported_aspect_ratios, "string"),
        durations: listOf<number>(m.supported_durations, "number"),
        frameImages: frames(m),
      });
    }
  }
  return (data ?? [])
    // "~…-latest" aliases duplicate real models; ":batch" ids are for the Batch API.
    .filter((m) => typeof m.id === "string" && !m.id.startsWith("~") && !m.id.endsWith(":batch"))
    .map((m) => ({
      id: m.id,
      name: m.name,
      capability,
      vision: m.architecture?.input_modalities?.includes("image"),
      reasoning: Array.isArray(m.supported_parameters) && m.supported_parameters.includes("reasoning"),
      // Unknown when the list doesn't describe the model's inputs.
      ...(capability === "image" && (m.architecture?.input_modalities || described(m))
        ? { photoEdit: Boolean(m.architecture?.input_modalities?.includes("image") || "input_references" in (described(m) ?? {})) }
        : {}),
      ...(capability === "video" && Array.isArray(m.supported_frame_images)
        ? {
            photoEdit: m.supported_frame_images.includes("first_frame"),
            lastFrame: m.supported_frame_images.includes("first_frame") && m.supported_frame_images.includes("last_frame"),
          }
        : {}),
    }));
}

async function fetchLive(provider: ProviderId, capability: Capability): Promise<LiveModel[] | null> {
  if (provider === "openrouter") return openRouterList(capability);
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
    const selfHosted = provider === "custom" || provider === "ollama";
    const models = await collect(
      openAIClient(provider).models.list(selfHosted ? { timeout: SELF_HOSTED_TIMEOUT_MS, maxRetries: 0 } : undefined),
    );
    return models.map((m) => ({ id: m.id }));
  }
  return null;
}

/** Live model list for a provider, or null when it can't be fetched. */
function liveModels(provider: ProviderId, capability: Capability): Promise<LiveModel[] | null> {
  // Only OpenRouter has a separate list per capability; others list everything at once.
  const key = provider === "openrouter" ? `${provider}:${capability}` : provider;
  const hit = cache.get(key);
  // While a list is being refreshed, callers get the last good one right away.
  if (hit && Date.now() - hit.at < TTL_MS) return hit.last ? Promise.resolve(hit.last) : hit.models;
  const timeout = provider === "custom" || provider === "ollama" ? SELF_HOSTED_TIMEOUT_MS : LIVE_TIMEOUT_MS;
  const entry: { at: number; models: Promise<LiveModel[] | null>; last?: LiveModel[] } = {
    at: Date.now(),
    models: withTimeout(fetchLive(provider, capability), timeout)
      .catch(() => null)
      .then((list) => {
        if (list) entry.last = list;
        // Nothing to fall back on (e.g. a GPU server still starting): try again soon.
        else if (!entry.last) entry.at = Date.now() - TTL_MS + RETRY_FAILED_MS;
        // A failed refresh keeps serving the last good list.
        return list ?? entry.last ?? null;
      }),
    last: hit?.last,
  };
  cache.set(key, entry);
  return entry.last ? Promise.resolve(entry.last) : entry.models;
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
      return m.capability ?? "chat";
    case "qwen":
      // Model Studio also hosts speech, embedding, translation, image and video models.
      return /(image|wan|tts|asr|embed|rerank|realtime|audio|omni|livetranslate|mt-|ocr|video)/.test(id) ? null : "chat";
    case "custom":
      return /(embed|rerank|whisper|tts)/.test(id) ? null : "chat";
    case "deepseek":
    case "ollama":
      return "chat";
    case "replicate":
    case "maryx":
    case "browser":
      return null;
  }
}

/** Web search is offered through OpenRouter's server tool. */
function canSearch(provider: ProviderId, capability: Capability): boolean | undefined {
  return provider === "openrouter" && capability === "chat" ? true : undefined;
}

/** Self-hosted models that read images: CUSTOM_LLM_VISION=1, or a known multimodal family. */
const SELF_HOSTED_VISION = /qwen3\.[5-9]|[-_.]vl\b|vl-|vision|gemma-?3|pixtral|llava|omni/i;

function liveModelInfo(provider: ProviderId, capability: Capability, m: LiveModel): ModelInfo {
  const id = m.id;
  const selfHostedVision =
    provider === "custom" && (process.env.CUSTOM_LLM_VISION?.trim() === "1" || SELF_HOSTED_VISION.test(id));
  return {
    search: canSearch(provider, capability),
    id,
    provider,
    label: m.name || id,
    capability,
    featured: false,
    vision: provider === "anthropic" || provider === "google" || selfHostedVision ? true : m.vision,
    // Only OpenRouter's media APIs take the user's photo (our other media adapters can't yet).
    ...(provider === "openrouter" && capability !== "chat" && m.photoEdit ? { photoEdit: true } : {}),
    ...(provider === "openrouter" && capability === "video" && m.lastFrame ? { lastFrame: true } : {}),
    reasoning:
      m.reasoning ||
      (provider === "anthropic" && ADAPTIVE_THINKING.test(id)) ||
      (provider === "openai" && OPENAI_REASONING.test(id)) ||
      (provider === "google" && THINKING_LEVEL_MODELS.test(id)),
  };
}

async function modelsFor(provider: ProviderId, capability: Capability, ownKey: boolean): Promise<ModelInfo[]> {
  const picks = FEATURED_MODELS.filter((m) => m.provider === provider && m.capability === capability);
  // A flagship offered through OpenRouter only stays on top when its own provider isn't set up
  // (or when the user brings their own OpenRouter key, which pays for it).
  const featured = picks
    .filter((m) => ownKey || !(m.upstream && isConfigured(m.upstream)))
    .map((m): ModelInfo => {
      const info: ModelInfo & { upstream?: ProviderId } = { ...m, featured: true, search: canSearch(provider, capability) };
      delete info.upstream;
      return info;
    });
  const live = await liveModels(provider, capability);

  // Provider unreachable: trust the curated list.
  if (live === null) return featured;

  const byId = new Map(live.map((m) => [m.id, m]));
  // A featured media model takes photos when OpenRouter's list says so (the catalog is the guess).
  const result = featured
    .filter((m) => byId.has(m.id))
    .map((m) => {
      const live = byId.get(m.id);
      // Only OpenRouter's list says which video models end on a given frame.
      const info = provider === "openrouter" && live?.lastFrame ? { ...m, lastFrame: true } : { ...m };
      if (live?.photoEdit === false) delete info.photoEdit;
      return info;
    });
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

/**
 * Loads OpenRouter's chat model list (cached for 10 minutes), which also tells
 * each model's reasoning settings, before a chat with a model picked by hand.
 */
export async function loadOpenRouterChatModels(ownKey = false): Promise<void> {
  if (!ownKey && !isConfigured("openrouter")) return;
  const load = liveModels("openrouter", "chat");
  // Wait only on a cold start, and briefly: the featured models are known anyway.
  if (!reasoningListLoaded()) await Promise.race([load, new Promise((r) => setTimeout(r, 1500))]);
}

/**
 * Providers and models available to a user. With their own OpenRouter key
 * (`ownKey`), OpenRouter's models are theirs even when the site has no key.
 */
export async function listModels(capability: Capability | null, opts: { ownKey?: boolean } = {}): Promise<ModelsResponse> {
  const ownKey = opts.ownKey ?? false;
  // `configured` is the site's own setup (the admin panel shows it); the user's key only adds models.
  const usable = (id: ProviderId) => isConfigured(id) || (ownKey && id === "openrouter");
  const providers = PROVIDERS.map((p) => ({
    ...p,
    configured: isConfigured(p.id),
    ...(ownKey && p.id === "openrouter" ? { ownKey: true } : {}),
  }));
  const capabilities: Capability[] = capability ? [capability] : ["chat", "image", "video"];

  const jobs = providers
    .filter((p) => usable(p.id))
    .flatMap((p) =>
      capabilities
        .filter((c) => p.capabilities.includes(c))
        .map((c) => modelsFor(p.id, c, ownKey && p.id === "openrouter")),
    );
  const models = (await Promise.all(jobs)).flat();
  if (capabilities.includes("chat")) {
    // MARYX routes to the real chat models on the server; with none set up it
    // runs in the visitor's browser on an open Qwen model, free and without keys.
    // Decided by configuration, so a model server that is briefly down doesn't
    // move visitors to a big download on their own devices.
    const onServer = providers.some((p) => usable(p.id) && p.capabilities.includes("chat"));
    models.unshift(
      onServer
        ? { ...MARYX_MODEL, search: isConfigured("openrouter") || ownKey || undefined }
        : {
            ...MARYX_MODEL,
            description: "Наш ИИ: работает прямо в вашем браузере на Qwen — бесплатно",
            vision: false,
            local: true,
          },
    );
    models.push(...BROWSER_MODELS);
  }
  return { providers, models };
}
