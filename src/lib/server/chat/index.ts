import type { ChatRequest, ChatStreamEvent } from "@/lib/types";
import { isOpenAICompatible } from "../config";
import { streamAnthropic } from "./anthropic";
import { streamGoogle } from "./google";
import { streamOpenAICompatible } from "./openai-compatible";

export function streamChat(req: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  if (req.provider === "anthropic") return streamAnthropic(req, signal);
  if (req.provider === "google") return streamGoogle(req, signal);
  if (isOpenAICompatible(req.provider)) return streamOpenAICompatible(req, signal);
  throw new Error(`Провайдер ${req.provider} не поддерживает чат`);
}
