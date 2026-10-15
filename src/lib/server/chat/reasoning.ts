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

/** The accepted effort nearest to `want`: at or above it when `up`, else at or below. */
function nearest(info: ReasoningInfo | undefined, want: string, up: boolean): string {
  const list = info?.efforts?.filter((e) => rank(e) >= 0);
  if (!list?.length || list.includes(want)) return want;
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
 * always reasons at "xhigh") are asked for "medium" in normal messages and
 * "low" in small jobs, so they aren't slow and expensive. Reasoning that is off
 * by default is never switched on except by "think deeper".
 */
export function openRouterEffort(model: string, effort: Effort): string | undefined {
  const info = known.get(model);
  const thinksByDefault = Boolean(info && (info.mandatory || info.defaultEnabled));
  const top = thinksByDefault && info?.defaultEffort !== undefined && rank(info.defaultEffort) >= rank("xhigh");
  if (effort === "deep") return nearest(info, top ? info!.defaultEffort! : "high", true);
  if (!top) return undefined;
  return nearest(info, effort === "light" ? "low" : "medium", false);
}

/** Qwen models on Alibaba's API that have an `enable_thinking` switch. */
const QWEN_HYBRID = /^(qwen3\.[5-7]|qwen-(plus|flash|turbo)|qwen3-max)/;

/**
 * Thinking switches for Qwen's own API: Qwen 3.8 takes `reasoning_effort` (low,
 * medium, xhigh; xhigh by default), older hybrid models `enable_thinking`.
 */
export function qwenThinking(model: string, effort: Effort): Record<string, unknown> {
  if (/^qwen3\.8/.test(model)) {
    return { reasoning_effort: effort === "deep" ? "xhigh" : effort === "light" ? "low" : "medium" };
  }
  return effort === "deep" && QWEN_HYBRID.test(model) ? { enable_thinking: true } : {};
}
