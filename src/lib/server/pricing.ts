// What AI requests cost, for the cost ledger and budgets. OpenRouter reports
// the exact cost of every call; for other providers (and for answers cut off
// before the provider reported usage) the cost is worked out from tokens and
// list prices. Those are estimates: rows made from them are marked so.

import type { ChatUsage, ProviderId } from "@/lib/types";
import { ADAPTIVE_THINKING } from "./chat/anthropic";
import { THINKING_MODELS } from "./chat/google";
import { OPENAI_REASONING } from "./chat/openai-compatible";
import { motionResolution } from "./config";

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

/**
 * The most a model can write in one answer (thinking included), where we know
 * it; undefined for models whose limit we don't know, which then get no limit
 * sent unless the budget or credits require one (see answerTokens).
 */
function knownLimit(provider: ProviderId, model: string): number | undefined {
  switch (provider) {
    case "openrouter":
      return openRouterLimits.get(model);
    case "anthropic":
      // The adapter's own maximum, which every Claude model takes.
      return ADAPTIVE_THINKING.test(model) ? 64_000 : 8192;
    case "google":
      return THINKING_MODELS.test(model) || /^gemini-(flash|pro)(-lite)?-latest/.test(model) ? 65_536 : 8192;
    case "openai":
      if (/^gpt-5.*chat/.test(model)) return 16_384;
      if (OPENAI_REASONING.test(model)) return 100_000;
      if (/gpt-4\.1/.test(model)) return 32_768;
      if (/gpt-4o|chatgpt-4o/.test(model)) return 16_384;
      if (/gpt-4-turbo|gpt-3\.5/.test(model)) return 4096;
      if (/^gpt-4/.test(model)) return 8192;
      return undefined;
    case "deepseek":
      // max_tokens includes the reasoner's chain of thought.
      return /reasoner/.test(model) ? 64_000 : 8192;
    case "qwen":
      return /^qwen-(max|plus|turbo)/.test(model) ? 8192 : undefined;
    default:
      return undefined;
  }
}

/** A limit every chat model accepts, for an answer that must be limited when the model's own isn't known. */
const SAFE_LIMIT = 8192;

/** The longest answer assumed of a model whose limit we don't know: what its room must pay for to send no limit. */
const UNKNOWN_LIMIT = 65_536;

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
 * one request from costing much more than was held for it.
 */
export function answerCap(deep: boolean, provider?: ProviderId, model?: string): number {
  const cap = deep ? 32_000 : 16_000;
  const limit = provider && model ? knownLimit(provider, model) : undefined;
  return limit ? Math.min(cap, limit) : cap;
}

/** Output a typical answer writes (thinking included): what is held for it while it runs. */
const TYPICAL_ANSWER = { normal: 2000, deep: 8000 };

/**
 * The least output an answer is allowed: below this the request is refused
 * rather than cut to nothing. A limited answer thinks less (see the chat
 * route), so this leaves room for the answer itself.
 */
export const MIN_ANSWER_TOKENS = 2000;

/** OpenRouter's web search: up to 2 searches of ~$0.007, their results read as ~10k tokens of input. */
const SEARCH = { usd: 0.014, tokens: 10_000 };

/**
 * Thinking that Qwen 3.8 on Alibaba's own API does on top of max_tokens,
 * which bounds only the reply there.
 */
function unboundedThinking(provider: ProviderId, model: string, effort: "normal" | "deep" | "light"): number {
  if (provider !== "qwen" || !/^qwen3\.8/.test(model)) return 0;
  return effort === "deep" ? 32_000 : effort === "light" ? 2000 : 8000;
}

/** Cost of a chat call's input, web search and Qwen's extra thinking: everything but its answer. */
function callBase(provider: ProviderId, model: string, inputChars: number, effort: "normal" | "deep" | "light", search?: boolean): number {
  const price = tokenPrice(provider, model);
  const searching = search && provider === "openrouter" ? SEARCH.usd + SEARCH.tokens * price.input : 0;
  return tokensOf(inputChars) * price.input + searching + unboundedThinking(provider, model, effort) * price.output;
}

/**
 * What a chat call may cost before it runs: `expected` with a typical answer
 * (held while it runs), `most` with a full-length one (if the budget or credits
 * can't cover it, the answer is limited to what they do cover) and `least`
 * with the shortest answer worth running (below that the request is refused).
 */
export function chatHold(
  provider: ProviderId,
  model: string,
  inputChars: number,
  deep: boolean,
  search?: boolean,
): { expected: number; most: number; least: number } {
  const out = tokenPrice(provider, model).output;
  const cap = answerCap(deep, provider, model);
  const base = callBase(provider, model, inputChars, deep ? "deep" : "normal", search);
  return {
    expected: base + Math.min(cap, deep ? TYPICAL_ANSWER.deep : TYPICAL_ANSWER.normal) * out,
    most: base + cap * out,
    // A limited answer thinks lightly (see the chat route).
    least: callBase(provider, model, inputChars, "light", search) + Math.min(cap, MIN_ANSWER_TOKENS) * out,
  };
}

/** How hard an answer thinks: as asked ("deep" with "think deeper"), or lighter when it must be limited. */
export type AnswerEffort = "deep" | "normal" | "light";

/**
 * How a paid answer runs: the output limit to send and how hard it thinks.
 * With `usd` (what the budget or credits have left for it) below its
 * full-length price, it is `limited` to what `usd` pays for after its input,
 * never below the shortest answer worth running, and thinks less when that is
 * too little for its usual thinking ("deep" keeps a typical deep answer's room,
 * "normal" twice the shortest answer's). For a model whose own limit we don't
 * know, no limit is sent when `usd` pays for a very long answer (or nothing
 * bounds it), and at most SAFE_LIMIT otherwise, so a cap above its limit
 * can't get the request rejected. No limit either for models on the owner's
 * own hardware, which cost nothing.
 */
export function answerLimits(
  provider: ProviderId,
  model: string,
  inputChars: number,
  deep: boolean,
  usd?: number,
  search?: boolean,
): { maxTokens?: number; effort: AnswerEffort; limited: boolean } {
  const asked: AnswerEffort = deep ? "deep" : "normal";
  const price = tokenPrice(provider, model);
  if (price.output <= 0) return { effort: asked, limited: false };
  const known = knownLimit(provider, model) !== undefined;
  const full = known
    ? chatHold(provider, model, inputChars, deep, search).most
    : callBase(provider, model, inputChars, asked, search) + UNKNOWN_LIMIT * price.output;
  if (usd === undefined || usd >= full) {
    return { maxTokens: known ? answerCap(deep, provider, model) : undefined, effort: asked, limited: false };
  }
  const efforts: AnswerEffort[] = deep ? ["deep", "normal", "light"] : ["normal", "light"];
  const room = (effort: AnswerEffort) => Math.floor((usd - callBase(provider, model, inputChars, effort, search)) / price.output);
  const effort =
    efforts.find((e) => room(e) >= (e === "deep" ? TYPICAL_ANSWER.deep : e === "normal" ? 2 * MIN_ANSWER_TOKENS : 0)) ?? "light";
  const cap = answerCap(effort === "deep", provider, model);
  const bound = known ? cap : SAFE_LIMIT;
  const tokens = room(effort);
  // `limited` means the money is what limits it (not SAFE_LIMIT).
  return { maxTokens: Math.max(Math.min(cap, MIN_ANSWER_TOKENS), Math.min(bound, tokens)), effort, limited: tokens < bound };
}

const IMAGE_PRICES: [RegExp, number][] = [
  // The site's own GPU: only its time (about a cent of a rented card's hour).
  [/^comfy\//, 0.002],
  [/schnell/, 0.003],
  [/gpt-image-1-mini|image-1-mini/, 0.011],
  [/gemini-3-pro-image|nano-banana-pro|imagen-4.*ultra/, 0.134],
  [/^/, 0.04],
];

/** USD per second of video. */
const VIDEO_PRICES: [RegExp, number][] = [
  [/^comfy\//, 0.005],
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

/** Higgsfield's motion transfer, per second of the trend, by the quality it's made in. */
const MOTION_PRICES = { "480p": 0.32, "720p": 0.68, "1080p": 1.64 };

/** Estimated cost of one generated picture or clip. */
export function mediaCost(kind: "image" | "video", model: string, seconds?: number): number {
  const id = model.toLowerCase();
  if (kind === "image") return IMAGE_PRICES.find(([re]) => re.test(id))![1];
  if (/genjutsu|motion-transfer/.test(id)) return MOTION_PRICES[motionResolution()] * Math.ceil(seconds && seconds > 0 ? seconds : 10);
  const perSecond = VIDEO_PRICES.find(([re]) => re.test(id))![1];
  return perSecond * (seconds && seconds > 0 ? seconds : defaultSeconds(id));
}

/** Estimated cost of transcribing a clip: about $0.003 per minute (gpt-4o-mini-transcribe), $0.006 for Whisper. */
export function transcriptionCost(model: string, seconds: number): number {
  const perMinute = /whisper/.test(model) ? 0.006 : 0.003;
  return (Math.max(1, seconds) / 60) * perMinute;
}
