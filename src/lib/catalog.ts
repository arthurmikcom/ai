// Provider metadata and the hand-picked ("featured") models shown at the top
// of every picker. The server cross-checks these against each provider's live
// model list, so an ID that a provider retires simply disappears from the UI
// and newly released models show up under "all models" without a code change.

import type { Capability, ModelInfo, ProviderId } from "./types";

export interface ProviderDef {
  id: ProviderId;
  name: string;
  envVar: string;
  signupUrl: string;
  capabilities: Capability[];
  note: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    signupUrl: "https://console.anthropic.com/settings/keys",
    capabilities: ["chat"],
    note: "Claude Opus, Sonnet, Haiku и Fable",
  },
  {
    id: "openai",
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    signupUrl: "https://platform.openai.com/api-keys",
    capabilities: ["chat", "image"],
    note: "GPT-модели и GPT Image",
  },
  {
    id: "google",
    name: "Google (Gemini)",
    envVar: "GEMINI_API_KEY",
    signupUrl: "https://aistudio.google.com/apikey",
    capabilities: ["chat", "image", "video"],
    note: "Gemini, Imagen, Nano Banana и видео Veo",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    signupUrl: "https://openrouter.ai/keys",
    capabilities: ["chat", "image", "video"],
    note: "Один ключ на всё: Claude, GPT, Gemini, Grok, DeepSeek, картинки и видео",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    envVar: "DEEPSEEK_API_KEY",
    signupUrl: "https://platform.deepseek.com/api_keys",
    capabilities: ["chat"],
    note: "DeepSeek Chat и DeepSeek Reasoner",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    envVar: "XAI_API_KEY",
    signupUrl: "https://console.x.ai",
    capabilities: ["chat"],
    note: "Модели Grok",
  },
  {
    id: "qwen",
    name: "Qwen (Alibaba Cloud)",
    envVar: "DASHSCOPE_API_KEY",
    signupUrl: "https://modelstudio.console.alibabacloud.com/",
    capabilities: ["chat"],
    note: "Qwen 3.8 Max и Flash напрямую от Alibaba",
  },
  {
    id: "ollama",
    name: "Ollama (свои локальные модели)",
    envVar: "OLLAMA_BASE_URL",
    signupUrl: "https://ollama.com/download",
    capabilities: ["chat"],
    note: "Открытые модели на вашем компьютере, без ключей и оплаты",
  },
  {
    id: "custom",
    name: "Свой сервер моделей",
    envVar: "CUSTOM_LLM_BASE_URL",
    signupUrl: "https://qwen.readthedocs.io/",
    capabilities: ["chat"],
    note: "Открытые модели (например Qwen) на вашем GPU-сервере: vLLM, SGLang, LM Studio",
  },
  {
    id: "replicate",
    name: "Replicate",
    envVar: "REPLICATE_API_TOKEN",
    signupUrl: "https://replicate.com/account/api-tokens",
    capabilities: ["image", "video"],
    note: "FLUX, Ideogram, Recraft, Kling, Veo, Seedance и тысячи других",
  },
];

/** Our own AI, shown first in the chat model picker (see server/maryx.ts). */
export const MARYX_MODEL: ModelInfo = {
  provider: "maryx",
  id: "maryx",
  label: "MARYX",
  description: "Наш ИИ: сам выбирает лучшую модель под каждую задачу",
  capability: "chat",
  featured: true,
  vision: true,
  reasoning: true,
};

/**
 * Open Qwen models that run in the visitor's browser through WebLLM (WebGPU):
 * free and without keys. Ids are WebLLM's without the quantization suffix
 * (client/local-ai.ts adds q4f16_1 or q4f32_1 for the visitor's GPU).
 */
export const BROWSER_MODELS: ModelInfo[] = [
  {
    provider: "browser",
    id: "Qwen3-1.7B",
    label: "Qwen 3 1.7B",
    description: "Бесплатно, без ключей: работает в вашем браузере (≈1 ГБ один раз)",
    capability: "chat",
    featured: true,
    vision: false,
    reasoning: true,
    local: true,
    downloadMB: 1000,
  },
  {
    provider: "browser",
    id: "Qwen3-4B",
    label: "Qwen 3 4B",
    description: "Умнее, для мощных компьютеров (≈2,3 ГБ один раз)",
    capability: "chat",
    featured: true,
    vision: false,
    reasoning: true,
    local: true,
    downloadMB: 2300,
  },
  {
    provider: "browser",
    id: "Qwen3-0.6B",
    label: "Qwen 3 0.6B",
    description: "Самая лёгкая, для телефонов и слабых устройств (≈0,4 ГБ)",
    capability: "chat",
    featured: true,
    vision: false,
    reasoning: true,
    local: true,
    downloadMB: 400,
  },
];

export function providerName(id: ProviderId): string {
  if (id === "maryx") return "MARYX Ai";
  if (id === "browser") return "Qwen в браузере — бесплатно";
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

export type Featured = Omit<ModelInfo, "featured"> & {
  /**
   * The same model is offered directly by this provider. The OpenRouter copy
   * is shown only when that provider's own key isn't set, so one OpenRouter
   * key is enough to get every flagship without listing them twice.
   */
  upstream?: ProviderId;
};

type Entry = Omit<Featured, "provider" | "capability">;

function viaOpenRouter(capability: Capability, entries: Entry[]): Featured[] {
  return entries.map((m) => ({ ...m, provider: "openrouter", capability }));
}

/** OpenRouter copies of the flagships (slugs from openrouter.ai/models). */
const OPENROUTER_CHAT = viaOpenRouter("chat", [
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", description: "Быстрая и умная — для повседневной работы", upstream: "anthropic", vision: true, reasoning: true },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", description: "Флагман Anthropic: сложные задачи, код, анализ", upstream: "anthropic", vision: true, reasoning: true },
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", description: "Самая быстрая и дешёвая Claude", upstream: "anthropic", vision: true, reasoning: true },
  { id: "anthropic/claude-fable-5.1", label: "Claude Fable 5.1", description: "Самая мощная модель Anthropic (дороже остальных)", upstream: "anthropic", vision: true, reasoning: true },
  { id: "openai/gpt-6-astra", label: "GPT-6 Astra", description: "Флагман OpenAI", upstream: "openai", vision: true, reasoning: true },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", description: "Почти как Astra, но дешевле", upstream: "openai", vision: true, reasoning: true },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", description: "Лёгкая и быстрая", upstream: "openai", vision: true, reasoning: true },
  { id: "google/gemini-4-argon", label: "Gemini 4 Argon", description: "Новейшая модель Google", upstream: "google", vision: true, reasoning: true },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", description: "Умная модель Google с огромной памятью", upstream: "google", vision: true, reasoning: true },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", description: "Быстрая и сильная модель Google", upstream: "google", vision: true, reasoning: true },
  { id: "x-ai/grok-4.7", label: "Grok 4.7", description: "Флагман xAI", upstream: "xai", vision: true, reasoning: true },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", description: "Сильная и недорогая", upstream: "deepseek", reasoning: true },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", description: "Очень быстрая и дешёвая", upstream: "deepseek", vision: true, reasoning: true },
  { id: "qwen/qwen3.8-max-0902", label: "Qwen 3.8 Max", description: "Флагман Alibaba: код, анализ, огромная память", upstream: "qwen", vision: true, reasoning: true },
  { id: "qwen/qwen3.8-flash", label: "Qwen 3.8 Flash", description: "Быстрая и очень дешёвая Qwen", upstream: "qwen", vision: true, reasoning: true },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", description: "Открытая модель Qwen: сильна в коде, недорогая", vision: true, reasoning: true },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", description: "Открытая модель Meta", vision: true },
  { id: "mistralai/mistral-large-4-0", label: "Mistral Large 4", description: "Европейская модель от Mistral", vision: true },
]);

const OPENROUTER_IMAGE = viaOpenRouter("image", [
  { id: "google/gemini-3.1-flash-image", label: "Nano Banana 2", description: "Gemini 3.1 Flash Image — быстро и красиво", upstream: "google" },
  { id: "google/gemini-3-pro-image", label: "Nano Banana Pro", description: "Gemini 3 Pro Image — лучше всех с текстом и деталями", upstream: "google" },
  { id: "openai/gpt-image-2", label: "GPT Image 2", description: "OpenAI: качественно и очень дёшево", upstream: "openai" },
  { id: "black-forest-labs/flux.2-pro", label: "FLUX.2 Pro", description: "Фотореализм от Black Forest Labs" },
  { id: "bytedance-seed/seedream-4.5", label: "Seedream 4.5", description: "Яркие детализированные картинки от ByteDance" },
  { id: "qwen/qwen-image-3", label: "Qwen Image 3", description: "Alibaba: точный текст на картинках, недорого" },
  { id: "qwen/qwen-image-3-pro", label: "Qwen Image 3 Pro", description: "Лучшее качество от Qwen" },
]);

const OPENROUTER_VIDEO = viaOpenRouter("video", [
  { id: "bytedance/seedance-2.0-fast", label: "Seedance 2.0 Fast", description: "Быстро и недорого" },
  { id: "google/veo-3.1-fast", label: "Veo 3.1 Fast", description: "Кинематографичное видео со звуком, быстрее", upstream: "google" },
  { id: "google/veo-3.1", label: "Veo 3.1", description: "Лучшее качество от Google, со звуком", upstream: "google" },
  { id: "kwaivgi/kling-v3.0-std", label: "Kling 3.0", description: "Реалистичное движение" },
  { id: "minimax/hailuo-3", label: "Hailuo 3", description: "Хорошая физика движения" },
  { id: "alibaba/wan-3.0", label: "Wan 3.0", description: "Новейшая модель Alibaba, со звуком" },
]);

export const FEATURED_MODELS: Featured[] = [
  // ----- Chat -----
  {
    provider: "anthropic",
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    description: "Флагман Anthropic: сложные задачи, код, анализ",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    description: "Быстрая и умная — для повседневной работы",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "anthropic",
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    description: "Самая быстрая и дешёвая Claude",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "anthropic",
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    description: "Самая мощная модель Anthropic (дороже остальных)",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "openai",
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    description: "Флагман OpenAI",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "openai",
    id: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    description: "Почти как Astra, но дешевле",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "openai",
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    description: "Лёгкая и быстрая",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "openai",
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    description: "Недорогая модель для простых задач",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "google",
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    description: "Самая умная модель Google",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "google",
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    description: "Быстрая и сильная модель Google",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "google",
    id: "gemini-flash-lite-latest",
    label: "Gemini Flash-Lite",
    description: "Самая дешёвая Gemini",
    capability: "chat",
    vision: true,
  },
  {
    provider: "deepseek",
    id: "deepseek-chat",
    label: "DeepSeek Chat",
    description: "Быстрая и очень дешёвая",
    capability: "chat",
  },
  {
    provider: "deepseek",
    id: "deepseek-reasoner",
    label: "DeepSeek Reasoner",
    description: "Думает перед ответом",
    capability: "chat",
  },
  {
    provider: "xai",
    id: "grok-4",
    label: "Grok 4",
    description: "Флагман xAI",
    capability: "chat",
  },
  {
    provider: "qwen",
    id: "qwen3.8-max",
    label: "Qwen 3.8 Max",
    description: "Флагман Alibaba: код, анализ, огромная память",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "qwen",
    id: "qwen3.8-flash",
    label: "Qwen 3.8 Flash",
    description: "Быстрая и очень дешёвая Qwen",
    capability: "chat",
    vision: true,
    reasoning: true,
  },
  {
    provider: "qwen",
    id: "qwen3.7-plus",
    label: "Qwen 3.7 Plus",
    description: "Сбалансированная модель Qwen",
    capability: "chat",
    vision: true,
    reasoning: true,
  },

  ...OPENROUTER_CHAT,

  // ----- Images -----
  {
    provider: "openai",
    id: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    description: "Лучшее качество от OpenAI",
    capability: "image",
  },
  {
    provider: "openai",
    id: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    description: "Быстрее и дешевле Sunburst",
    capability: "image",
  },
  {
    provider: "openai",
    id: "gpt-image-1-mini",
    label: "GPT Image 1 mini",
    description: "Самая дешёвая",
    capability: "image",
  },
  {
    provider: "google",
    id: "gemini-3-pro-image",
    label: "Nano Banana Pro",
    description: "Gemini 3 Pro Image — отлично понимает текст и детали",
    capability: "image",
  },
  {
    provider: "google",
    id: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
    description: "Быстрая генерация от Google",
    capability: "image",
  },
  {
    provider: "google",
    id: "imagen-4.0-generate-001",
    label: "Imagen 4",
    description: "Фотореализм от Google",
    capability: "image",
  },
  {
    provider: "replicate",
    id: "black-forest-labs/flux-1.1-pro",
    label: "FLUX 1.1 Pro",
    description: "Одна из лучших открытых архитектур",
    capability: "image",
  },
  {
    provider: "replicate",
    id: "black-forest-labs/flux-schnell",
    label: "FLUX Schnell",
    description: "Очень быстро и дёшево",
    capability: "image",
  },
  {
    provider: "replicate",
    id: "ideogram-ai/ideogram-v3-turbo",
    label: "Ideogram v3 Turbo",
    description: "Лучше всех пишет текст на картинках",
    capability: "image",
  },
  {
    provider: "replicate",
    id: "recraft-ai/recraft-v3",
    label: "Recraft v3",
    description: "Дизайн, иллюстрации, логотипы",
    capability: "image",
  },

  ...OPENROUTER_IMAGE,

  // ----- Video -----
  {
    provider: "google",
    id: "veo-3.1-generate-preview",
    label: "Veo 3.1",
    description: "Кинематографичное видео со звуком",
    capability: "video",
  },
  {
    provider: "google",
    id: "veo-3.1-fast-generate-preview",
    label: "Veo 3.1 Fast",
    description: "Быстрее и дешевле",
    capability: "video",
  },
  {
    provider: "replicate",
    id: "google/veo-3.1",
    label: "Veo 3.1 (Replicate)",
    description: "Veo через Replicate",
    capability: "video",
  },
  {
    provider: "replicate",
    id: "kwaivgi/kling-v2.5-turbo-pro",
    label: "Kling 2.5 Turbo Pro",
    description: "Реалистичное движение",
    capability: "video",
  },
  {
    provider: "replicate",
    id: "bytedance/seedance-1-pro",
    label: "Seedance 1 Pro",
    description: "Качественно и недорого",
    capability: "video",
  },
  {
    provider: "replicate",
    id: "minimax/hailuo-02",
    label: "Hailuo 02",
    description: "Хорошая физика движения",
    capability: "video",
  },
  {
    provider: "replicate",
    id: "wan-video/wan-2.2-t2v-fast",
    label: "Wan 2.2 Fast",
    description: "Открытая модель, быстро и дёшево",
    capability: "video",
  },
  ...OPENROUTER_VIDEO,
];
