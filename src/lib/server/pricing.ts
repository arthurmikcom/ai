// What AI requests cost, for the cost ledger and budgets. OpenRouter reports
// the exact cost of every call; for other providers (and for answers cut off
// before the provider reported usage) the cost is worked out from tokens and
// list prices. Those are estimates: rows made from them are marked so.

import type { ChatUsage, ProviderId } from "@/lib/types";

/** USD per token, as OpenRouter lists them (from /models, see listModels). */
interface TokenPrice {
  input: number;
  output: number;
}

const openRouterPrices = new Map<string, TokenPrice>();
/** The most each OpenRouter model can write in one answer. */
const openRouterLimits = new Map<string, number>();

export function rememberPrice(model: string, price: TokenPrice, maxOutput?: number): void {
  openRouterPrices.set(model, price);
  if (maxOutput) openRouterLimits.set(model, maxOutput);
  else openRouterLimits.delete(model);
}

/** The most a model can write in one answer, where it's lower than our caps (or unknown: undefined). */
function outputLimit(provider: ProviderId, model: string): number | undefined {
  if (provider === "openrouter") return openRouterLimits.get(model);
  if (provider === "deepseek") return 8192;
  return undefined;
}

const M = 1_000_000;

/**
 * List prices in USD per million tokens [input, output], by model family. The
 * first pattern that matches the model id wins (ids like claude-opus-4-8 and
 * anthropic/claude-opus-4.8 alike); a model nobody lists gets the last row,
 * which is deliberately high so an unknown model is over- rather than
 * under-counted. They only matter until the provider says better.
 */
const FAMILIES: [RegExp, number, number][] = [
  [/fable|mythos/, 10, 50],
  [/opus-4([-.][01])?($|-20\d{6}|:)|3-opus/, 15, 75],
  [/opus-5[-.]5/, 4, 20],
  [/opus/, 5, 25],
  [/sonnet-[34]|3(-\d)?-sonnet/, 3, 15],
  [/sonnet/, 2, 10],
  [/haiku-5/, 0.1, 0.5],
  [/haiku-3[-.]5|3-5-haiku/, 0.8, 4],
  [/haiku-3|3-haiku/, 0.25, 1.25],
  [/haiku/, 1, 5],
  [/gpt-\d+(\.\d+)?-astra|gpt-\d+(\.\d+)?-pro|\bo\d-pro/, 5, 30],
  [/\b(luna|mini|nano|lite)\b|flash-lite/, 0.25, 2],
  [/-sol\b|gpt-|\bo\d/, 2, 12],
  [/gemini.*flash/, 0.3, 2.5],
  [/gemini|argon/, 2, 12],
  [/grok/, 3, 15],
  [/deepseek.*flash/, 0.1, 0.4],
  [/deepseek/, 0.3, 1.2],
  [/qwen.*max/, 1.2, 6],
  [/qwen.*flash|qwen.*0\.6b|qwen.*1\.7b/, 0.05, 0.4],
  [/qwen/, 0.4, 1.6],
  [/llama/, 0.2, 0.6],
  [/mistral|mixtral/, 2, 6],
  [/^/, 5, 25],
];

function listPrice(model: string): TokenPrice {
  const id = model.toLowerCase();
  const [, input, output] = FAMILIES.find(([re]) => re.test(id))!;
  return { input: input / M, output: output / M };
}

/** Self-hosted models run on hardware the owner pays for anyway. */
function isSelfHosted(provider: ProviderId): boolean {
  return provider === "ollama" || provider === "custom" || provider === "browser";
}

/**
 * Cost of one chat call in USD and whether it was estimated. The provider's
 * own figure is used when it gave one.
 */
export function chatCost(provider: ProviderId, model: string, usage: ChatUsage): { usd: number; estimated: boolean } {
  if (typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) {
    return { usd: usage.cost, estimated: false };
  }
  const price = tokenPrice(provider, model);
  return { usd: usage.inputTokens * price.input + usage.outputTokens * price.output, estimated: !isSelfHosted(provider) };
}

/** USD per input and output token of a chat model (0 for models on the owner's own hardware). */
export function tokenPrice(provider: ProviderId, model: string): TokenPrice {
  if (isSelfHosted(provider) || provider === "maryx") return { input: 0, output: 0 };
  return (provider === "openrouter" ? openRouterPrices.get(model) : undefined) ?? listPrice(model);
}

/** Rough token count of text: ~3.5 characters per token for Russian and English alike. */
export function tokensOf(chars: number): number {
  return Math.ceil(chars / 3.5);
}

/**
 * The most a chat answer may write (thinking included) when it's paid by the
 * site's plans or by credits: plenty for any answer, and the bound that keeps
 * one request from costing more than was held for it.
 */
export function answerCap(deep: boolean, provider?: ProviderId, model?: string): number {
  const cap = deep ? 32_000 : 16_000;
  const limit = provider && model ? outputLimit(provider, model) : undefined;
  return limit ? Math.min(cap, limit) : cap;
}

/** The least output an answer is allowed: below this the request is refused rather than cut to nothing. */
export const MIN_ANSWER_TOKENS = 300;

/**
 * What a chat call may cost before it runs: `most` with a full-length answer
 * (the hold, when the budget or credits allow it), `least` with the shortest
 * answer worth running (when they don't, the answer is limited to what they cover).
 */
export function chatHold(provider: ProviderId, model: string, inputChars: number, deep: boolean): { most: number; least: number } {
  const price = tokenPrice(provider, model);
  const input = tokensOf(inputChars) * price.input;
  return { most: input + answerCap(deep, provider, model) * price.output, least: input + MIN_ANSWER_TOKENS * price.output };
}

/**
 * The most a paid answer may write: the cap, or what `usd` (the budget or
 * credits left for it) pays for after the input, but never below the
 * shortest answer worth running. Undefined for models on the owner's own
 * hardware, which cost nothing (and whose limits we don't know).
 */
export function answerTokens(provider: ProviderId, model: string, inputChars: number, deep: boolean, usd?: number): number | undefined {
  const price = tokenPrice(provider, model);
  if (price.output <= 0) return undefined;
  const cap = answerCap(deep, provider, model);
  if (usd === undefined) return cap;
  const room = (usd - tokensOf(inputChars) * price.input) / price.output;
  return Math.max(MIN_ANSWER_TOKENS, Math.min(cap, Math.floor(room)));
}

const IMAGE_PRICES: [RegExp, number][] = [
  [/schnell/, 0.003],
  [/gpt-image-1-mini|image-1-mini/, 0.011],
  [/gemini-3-pro-image|nano-banana-pro|imagen-4.*ultra/, 0.134],
  [/^/, 0.04],
];

/** USD per second of video. */
const VIDEO_PRICES: [RegExp, number][] = [
  [/veo.*fast/, 0.15],
  [/veo/, 0.4],
  [/seedance.*fast|wan.*fast/, 0.03],
  [/kling|hailuo|seedance|wan/, 0.08],
  [/^/, 0.2],
];

/** Clip length when the request doesn't say: Veo makes 8 seconds by default, most others 5–6. */
function defaultSeconds(id: string): number {
  return /veo/.test(id) ? 8 : 6;
}

/** Estimated cost of one generated picture or clip. */
export function mediaCost(kind: "image" | "video", model: string, seconds?: number): number {
  const id = model.toLowerCase();
  if (kind === "image") return IMAGE_PRICES.find(([re]) => re.test(id))![1];
  const perSecond = VIDEO_PRICES.find(([re]) => re.test(id))![1];
  return perSecond * (seconds && seconds > 0 ? seconds : defaultSeconds(id));
}

/** Estimated cost of transcribing a clip: about $0.003 per minute (gpt-4o-mini-transcribe), $0.006 for Whisper. */
export function transcriptionCost(model: string, seconds: number): number {
  const perMinute = /whisper/.test(model) ? 0.006 : 0.003;
  return (Math.max(1, seconds) / 60) * perMinute;
}
