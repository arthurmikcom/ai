// How hard a model should think. OpenRouter's model list says, per model, which
// reasoning efforts it accepts and what it uses by default; Qwen's own API has
// two styles of switches. Both are turned into request fields here.

/** OpenRouter's reasoning settings for one model (from /models). */
export interface ReasoningInfo {
  /** Reasoning can't be turned off. */
  mandatory: boolean;
  defaultEffort?: string;
  /** Accepted efforts; null means any. */
  efforts: string[] | null;
}

const known = new Map<string, ReasoningInfo>();

/** Filled from OpenRouter's model list (see listModels), which MARYX loads for every message. */
export function rememberReasoning(model: string, info: ReasoningInfo): void {
  known.set(model, info);
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
 * The `reasoning.effort` to send to OpenRouter, or undefined for the model's own
 * default. "Think deeper" asks for at least "high". Otherwise models that think
 * at their very top effort by default (Qwen 3.8 Max always reasons at "xhigh")
 * are asked for "medium", so a simple question isn't slow and expensive.
 */
export function openRouterEffort(model: string, deep: boolean): string | undefined {
  const info = known.get(model);
  const top = info?.defaultEffort !== undefined && rank(info.defaultEffort) >= rank("xhigh");
  if (deep) return nearest(info, top ? info!.defaultEffort! : "high", true);
  return top ? nearest(info, "medium", false) : undefined;
}

/**
 * Thinking switches for Qwen's own API: Qwen 3.8 takes `reasoning_effort` (low,
 * medium, xhigh; xhigh by default), older hybrid models `enable_thinking`.
 */
export function qwenThinking(model: string, deep: boolean): Record<string, unknown> {
  if (/^qwen3\.8/.test(model)) return { reasoning_effort: deep ? "xhigh" : "medium" };
  return deep ? { enable_thinking: true } : {};
}
