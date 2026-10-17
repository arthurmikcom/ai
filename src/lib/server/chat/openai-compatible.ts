import type OpenAI from "openai";
import type { ChatRequest, ChatStreamEvent } from "@/lib/types";
import { openAIClient } from "../config";
import { openRouterEffort, qwenThinking, selfHostedThinking, type Effort } from "./reasoning";

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
  const client = openAIClient(req.provider, req.apiKey);
  const reasons = req.provider === "openai" && OPENAI_REASONING.test(req.model);
  // "Think deeper" thinks hard; small jobs and answers short of budget think little.
  // (-pro models take only "high".)
  const openAIEffort = reasons && req.deepThinking ? "high" : reasons && req.light && !/-pro\b/.test(req.model) ? "low" : undefined;
  // OpenRouter takes one reasoning setting for every model and maps it to
  // each provider's own (models without reasoning ignore it).
  const mode: Effort = req.deepThinking ? "deep" : req.light ? "light" : "normal";
  const effort = req.provider === "openrouter" ? openRouterEffort(req.model, mode) : undefined;
  // OpenRouter's web search server tool: the model decides when to search.
  // The Exa engine has a fixed price (~$0.007 per search) and returns page
  // excerpts; max_uses caps how many searches one answer may run.
  const search =
    req.webSearch && req.provider === "openrouter"
      ? {
          tools: [{ type: "openrouter:web_search", parameters: { engine: "exa", max_results: 5, max_uses: 2 } }],
          max_tool_calls: 3,
        }
      : {};

  // OpenRouter always ends a stream with its usage (and cost); others need asking.
  // Self-hosted servers cost nothing to track, and some reject unknown fields.
  const usage = req.provider !== "openrouter" && req.provider !== "ollama" && req.provider !== "custom";

  const stream = await client.chat.completions.create(
    {
      model: req.model,
      messages: toMessages(req),
      stream: true,
      ...(usage ? { stream_options: { include_usage: true } } : {}),
      // OpenAI's reasoning models take only max_completion_tokens; the others take max_tokens.
      ...(req.maxTokens ? (req.provider === "openai" ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }) : {}),
      ...(req.provider === "openrouter" && req.endUser ? { user: req.endUser } : {}),
      ...(openAIEffort ? { reasoning_effort: openAIEffort } : {}),
      ...(effort ? ({ reasoning: { effort } } as object) : {}),
      ...(req.provider === "qwen" ? qwenThinking(req.model, mode) : {}),
      ...(req.provider === "custom" ? selfHostedThinking(req.model, mode) : {}),
      ...(search as object),
    },
    { signal },
  );

  const cited = new Set<string>();
  let finished = false;

  for await (const chunk of stream) {
    // OpenRouter reports a provider failure mid-stream as a chunk with an
    // `error` field (the HTTP status is already 200).
    const failure = (chunk as { error?: { message?: string; code?: number | string } }).error;
    if (failure) {
      throw Object.assign(new Error(failure.message || "Провайдер прервал ответ"), {
        status: typeof failure.code === "number" ? failure.code : undefined,
      });
    }
    // The last chunk carries what the call used (OpenAI sends it with no choices,
    // OpenRouter repeats the finish reason in it).
    if (chunk.usage) {
      const cost = (chunk.usage as { cost?: number | null }).cost;
      yield {
        type: "usage",
        usage: {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          ...(typeof cost === "number" ? { cost } : {}),
        },
      };
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

    // Web search results arrive as url_citation annotations (OpenRouter).
    const annotations = (delta as { annotations?: unknown }).annotations;
    if (Array.isArray(annotations)) {
      for (const a of annotations as { type?: string; url_citation?: { url?: string; title?: string } }[]) {
        const url = a?.type === "url_citation" ? a.url_citation?.url : undefined;
        if (!url || !/^https?:\/\//i.test(url) || cited.has(url)) continue;
        cited.add(url);
        yield { type: "source", url, title: a.url_citation?.title || undefined };
      }
    }

    // OpenRouter repeats the finish reason in its final usage chunk; report it once.
    if (choice.finish_reason && !finished) {
      finished = true;
      if (choice.finish_reason === "length") {
        yield { type: "notice", text: "Ответ обрезан: достигнут лимит длины." };
      } else if (choice.finish_reason === "content_filter") {
        yield { type: "notice", text: "Ответ остановлен фильтром безопасности провайдера." };
      }
    }
  }
}
