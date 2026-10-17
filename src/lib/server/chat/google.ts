import { ThinkingLevel, type Content, type Part } from "@google/genai";
import type { ChatRequest, ChatStreamEvent } from "@/lib/types";
import { googleClient } from "../config";

const THINKING_MODELS = /^gemini-(2\.5|3)/;
export const THINKING_LEVEL_MODELS = /^gemini-3/;

function toContents(req: ChatRequest): Content[] {
  return req.messages.map((m) => {
    const parts: Part[] = (m.attachments ?? []).map((a) => ({
      inlineData: { mimeType: a.mime, data: a.data },
    }));
    if (m.content || parts.length === 0) parts.push({ text: m.content || " " });
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });
}

export async function* streamGoogle(
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const ai = googleClient();
  const thinking = THINKING_MODELS.test(req.model);

  const stream = await ai.models.generateContentStream({
    model: req.model,
    contents: toContents(req),
    config: {
      abortSignal: signal,
      ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
      ...(req.system ? { systemInstruction: req.system } : {}),
      ...(thinking
        ? {
            thinkingConfig: {
              includeThoughts: true,
              ...(req.deepThinking && THINKING_LEVEL_MODELS.test(req.model)
                ? { thinkingLevel: ThinkingLevel.HIGH }
                : {}),
            },
          }
        : {}),
    },
  });

  for await (const chunk of stream) {
    // The totals so far come with every chunk (thinking is billed as output), so a stopped answer keeps them.
    const used = chunk.usageMetadata;
    if (used) {
      yield {
        type: "usage",
        usage: {
          inputTokens: used.promptTokenCount ?? 0,
          outputTokens: (used.candidatesTokenCount ?? 0) + (used.thoughtsTokenCount ?? 0),
        },
      };
    }
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (!part.text) continue;
      yield part.thought
        ? { type: "reasoning", text: part.text }
        : { type: "text", text: part.text };
    }
    if (candidate?.finishReason === "MAX_TOKENS") {
      yield { type: "notice", text: "Ответ обрезан: достигнут лимит длины." };
    } else if (candidate?.finishReason === "SAFETY") {
      yield { type: "notice", text: "Ответ остановлен фильтром безопасности Google." };
    }
  }
}
