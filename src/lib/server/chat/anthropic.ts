import type Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, ChatStreamEvent } from "@/lib/types";
import { anthropicClient } from "../config";

// Models that take adaptive thinking and `effort`. Older Claude models (e.g.
// Haiku 4.5, Sonnet 4.5) still use a fixed thinking budget and would reject it.
export const ADAPTIVE_THINKING = /^claude-((fable|mythos|opus|sonnet|haiku)-5|(opus|sonnet)-4-[678])/;

// Models that accept server-side refusal fallbacks in the "default" form: if the
// model's safety classifiers decline, the API re-runs the request on a
// recommended fallback model instead of returning a refusal.
const SERVER_FALLBACK = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function toMessages(req: ChatRequest): Anthropic.Beta.BetaMessageParam[] {
  return req.messages.map((m): Anthropic.Beta.BetaMessageParam => {
    if (m.role === "assistant" || !m.attachments?.length) {
      return { role: m.role, content: m.content };
    }
    return {
      role: "user",
      content: [
        ...m.attachments.map(
          (a): Anthropic.Beta.BetaImageBlockParam => ({
            type: "image",
            source: { type: "base64", media_type: a.mime as ImageMediaType, data: a.data },
          }),
        ),
        { type: "text", text: m.content || "Что на изображении?" },
      ],
    };
  });
}

export async function* streamAnthropic(
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const client = anthropicClient();
  const adaptive = ADAPTIVE_THINKING.test(req.model);

  const stream = client.beta.messages.stream(
    {
      model: req.model,
      max_tokens: adaptive ? 64000 : 8192,
      ...(req.system ? { system: req.system } : {}),
      messages: toMessages(req),
      // Summarized thinking lets the UI show what the model is reasoning about
      // instead of a long silent pause before the answer.
      ...(adaptive ? { thinking: { type: "adaptive", display: "summarized" } } : {}),
      ...(adaptive && req.deepThinking ? { output_config: { effort: "high" } } : {}),
      ...(SERVER_FALLBACK.has(req.model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
        : {}),
    },
    { signal },
  );

  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "fallback") {
      const { from, to } = event.content_block;
      yield { type: "notice", text: `${from.model} отклонила запрос — ответ продолжила ${to.model}.` };
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      } else if (event.delta.type === "thinking_delta") {
        yield { type: "reasoning", text: event.delta.thinking };
      }
    }
  }

  const final = await stream.finalMessage();
  const used = final.usage;
  yield {
    type: "usage",
    usage: {
      // Cache reads and writes are billed differently, but count as input here.
      inputTokens: used.input_tokens + (used.cache_creation_input_tokens ?? 0) + (used.cache_read_input_tokens ?? 0),
      outputTokens: used.output_tokens,
    },
  };
  if (final.stop_reason === "refusal") {
    yield { type: "notice", text: "Модель отказалась отвечать на этот запрос." };
  } else if (final.stop_reason === "max_tokens") {
    yield { type: "notice", text: "Ответ обрезан: достигнут лимит длины." };
  }
}
