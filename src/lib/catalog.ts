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
    capabilities: ["chat"],
    note: "Сотни моделей через один ключ: Llama, Mistral, Qwen, DeepSeek и др.",
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
    id: "ollama",
    name: "Ollama (свои локальные модели)",
    envVar: "OLLAMA_BASE_URL",
    signupUrl: "https://ollama.com/download",
    capabilities: ["chat"],
    note: "Открытые модели на вашем компьютере, без ключей и оплаты",
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

export function providerName(id: ProviderId): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

type Featured = Omit<ModelInfo, "featured">;

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
    provider: "openrouter",
    id: "meta-llama/llama-4-maverick",
    label: "Llama 4 Maverick",
    description: "Открытая модель Meta",
    capability: "chat",
  },
  {
    provider: "openrouter",
    id: "qwen/qwen3-max",
    label: "Qwen3 Max",
    description: "Флагман Alibaba",
    capability: "chat",
  },
  {
    provider: "openrouter",
    id: "mistralai/mistral-large",
    label: "Mistral Large",
    description: "Европейская модель от Mistral",
    capability: "chat",
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
];
