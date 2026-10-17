// How hard a model should think. OpenRouter's model list says, per model, which
// reasoning efforts it accepts and what it uses by default; Qwen's own API has
// two styles of switches. Both are turned into request fields here.

/** OpenRouter's reasoning settings for one model (from /models). */
export interface ReasoningInfo {
  /** Reasoning can't be turned off. */
  mandatory: boolean;
  /** Reasoning is on unless the request turns it off. */
  defaultEnabled: boolean;
  defaultEffort?: string;
  /** Accepted efforts; null means any. */
  efforts: string[] | null;
}

/**
 * Filled from OpenRouter's model list (see listModels). The featured Qwen models
 * are known up front, so they behave right even before the list has loaded.
 */
const known = new Map<string, ReasoningInfo>([
  [
    "qwen/qwen3.8-max-0902",
    { mandatory: true, defaultEnabled: true, defaultEffort: "xhigh", efforts: ["minimal", "low", "medium", "high", "xhigh"] },
  ],
  ["qwen/qwen3.8-27b", { mandatory: false, defaultEnabled: true, defaultEffort: "xhigh", efforts: ["low", "medium", "xhigh"] }],
]);

export function rememberReasoning(model: string, info: ReasoningInfo): void {
  known.set(model, info);
}

/** True once the live list has added more than the built-in entries. */
export function reasoningListLoaded(): boolean {
  return known.size > 2;
}

const LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const rank = (effort: string) => LEVELS.indexOf(effort);

/**
 * The accepted effort nearest to `want`: at or above it when `up`, else at or
 * below. Undefined when the model lists efforts but none we know.
 */
function nearest(info: ReasoningInfo | undefined, want: string, up: boolean): string | undefined {
  if (!info?.efforts) return want;
  const list = info.efforts.filter((e) => rank(e) >= 0);
  if (!list.length) return undefined;
  if (list.includes(want)) return want;
  const sorted = [...list].sort((a, b) => rank(a) - rank(b));
  if (up) return sorted.find((e) => rank(e) > rank(want)) ?? sorted[sorted.length - 1];
  return [...sorted].reverse().find((e) => rank(e) < rank(want)) ?? sorted[0];
}

/**
 * How much thinking a request asks for: "deep" is the "think deeper" switch,
 * "light" is MARYX's own small jobs (titles, suggestions, memory).
 */
export type Effort = "normal" | "deep" | "light";

/**
 * The `reasoning.effort` to send to OpenRouter, or undefined for the model's own
 * default. "Think deeper" asks for at least "high" (never below the model's
 * default). Models that think at their very top effort by default (Qwen 3.8 Max
 * always reasons at "xhigh") are asked for "medium" in normal messages, so they
 * aren't slow and expensive. Small jobs and answers short of budget ("light")
 * ask any model that thinks by default for "low". Reasoning that is off by
 * default is never switched on except by "think deeper".
 */
export function openRouterEffort(model: string, effort: Effort): string | undefined {
  const info = known.get(model);
  const fallback = info?.defaultEffort !== undefined ? rank(info.defaultEffort) : -1;
  if (effort === "deep") {
    // Never less than "high" or than what the model does by default.
    const pick = nearest(info, fallback > rank("high") ? info!.defaultEffort! : "high", true);
    const floor = fallback >= 0 ? Math.min(rank("high"), fallback) : rank("high");
    return pick !== undefined && rank(pick) >= floor ? pick : undefined;
  }
  // A listed default of "none" means reasoning is off by default.
  const thinksByDefault = Boolean(info && (info.mandatory || (info.defaultEnabled && info.defaultEffort !== "none")));
  if (!thinksByDefault) return undefined;
  if (effort === "light") {
    // Only ever lower than the model's own default.
    const pick = nearest(info, "low", false);
    return pick !== undefined && (fallback < 0 || rank(pick) < fallback) ? pick : undefined;
  }
  if (fallback < rank("xhigh")) return undefined;
  // At least "medium", and only if that is still below the model's own default.
  const pick = nearest(info, "medium", true);
  return pick !== undefined && rank(pick) < fallback ? pick : undefined;
}

/** Qwen models on Alibaba's API that have an `enable_thinking` switch. */
const QWEN_HYBRID = /^(qwen3\.[5-7]|qwen-(plus|flash|turbo)|qwen3-max)/;

/**
 * Thinking switches for Qwen's own API: Qwen 3.8 takes `reasoning_effort` (low,
 * medium, xhigh; xhigh by default), older hybrid models `enable_thinking`.
 */
export function qwenThinking(model: string, effort: Effort): Record<string, unknown> {
  if (/^qwen3\.8/.test(model)) return { reasoning_effort: qwen38Effort(effort) };
  // Hybrids (Qwen 3.6 and 3.7 think by default) get an explicit switch; "-thinking" snapshots always think.
  return QWEN_HYBRID.test(model) && !/thinking/.test(model) ? { enable_thinking: effort === "deep" } : {};
}

function qwen38Effort(effort: Effort): string {
  return effort === "deep" ? "xhigh" : effort === "light" ? "low" : "medium";
}

/**
 * Own servers (vLLM, SGLang, llama.cpp) pass `chat_template_kwargs` to the
 * model's chat template; Qwen templates read these, others ignore them. Qwen 3.8
 * would otherwise always think at "xhigh", and small jobs shouldn't think at all.
 */
export function selfHostedThinking(model: string, effort: Effort): Record<string, unknown> {
  if (/qwen3\.8/i.test(model)) return { chat_template_kwargs: { reasoning_effort: qwen38Effort(effort) } };
  return effort === "light" ? { chat_template_kwargs: { enable_thinking: false } } : {};
}
