import type OpenAI from "openai";
import type { ChatRequest, ChatStreamEvent } from "@/lib/types";
import { openAIClient } from "../config";

// OpenAI models that accept `reasoning_effort`.
export const OPENAI_REASONING = /^(gpt-5|gpt-6|o\d)/;

function toMessages(req: ChatRequest): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });

  for (const m of req.messages) {
    if (m.role === "assistant") {
      messages.push({ role: "assistant", content: m.content });
    } else if (m.attachments?.length) {
      messages.push({
        role: "user",
        content: [
          ...m.attachments.map(
            (a): OpenAI.ChatCompletionContentPartImage => ({
              type: "image_url",
              image_url: { url: `data:${a.mime};base64,${a.data}` },
            }),
          ),
          { type: "text", text: m.content || "Что на изображении?" },
        ],
      });
    } else {
      messages.push({ role: "user", content: m.content });
    }
  }
  return messages;
}

/** Streams from OpenAI, OpenRouter, DeepSeek, xAI or a local Ollama server. */
export async function* streamOpenAICompatible(
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const client = openAIClient(req.provider);
  const deep = req.deepThinking && req.provider === "openai" && OPENAI_REASONING.test(req.model);
  // OpenRouter takes one reasoning setting for every model and maps it to
  // each provider's own (models without reasoning ignore it).
  const openRouterDeep = req.deepThinking && req.provider === "openrouter";

  const stream = await client.chat.completions.create(
    {
      model: req.model,
      messages: toMessages(req),
      stream: true,
      ...(deep ? { reasoning_effort: "high" as const } : {}),
      ...(openRouterDeep ? ({ reasoning: { effort: "high" } } as object) : {}),
    },
    { signal },
  );

  for await (const chunk of stream) {
    // OpenRouter reports a provider failure mid-stream as a chunk with an
    // `error` field (the HTTP status is already 200).
    const failure = (chunk as { error?: { message?: string; code?: number | string } }).error;
    if (failure) {
      throw Object.assign(new Error(failure.message || "Провайдер прервал ответ"), {
        status: typeof failure.code === "number" ? failure.code : undefined,
      });
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    // DeepSeek streams its chain of thought as `reasoning_content`, OpenRouter
    // as `reasoning`; neither field is in the OpenAI types.
    const delta = choice.delta as typeof choice.delta & {
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (reasoning) yield { type: "reasoning", text: reasoning };
    if (delta.content) yield { type: "text", text: delta.content };

    if (choice.finish_reason === "length") {
      yield { type: "notice", text: "Ответ обрезан: достигнут лимит длины." };
    } else if (choice.finish_reason === "content_filter") {
      yield { type: "notice", text: "Ответ остановлен фильтром безопасности провайдера." };
    }
  }
}
