"use client";

import { KeyRound, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useModels } from "@/lib/client/useModels";
import { useApp, type ModelChoice } from "../AppState";
import { findModel, ModelPicker } from "../ModelPicker";
import { Composer } from "./Composer";
import { MessageView } from "./MessageView";

const SUGGESTIONS = [
  { title: "Объясни просто", text: "Объясни, как работают нейросети, как будто мне 12 лет" },
  { title: "Напиши код", text: "Напиши на Python скрипт, который переименовывает фото по дате съёмки" },
  { title: "Составь план", text: "Составь план запуска своего онлайн-сервиса за 30 дней" },
  { title: "Придумай идеи", text: "Придумай 10 идей для AI-стартапа с описанием и монетизацией" },
];

export function ChatView() {
  const app = useApp();
  const { data, loading } = useModels("chat");
  const models = useMemo(() => data?.models ?? [], [data]);
  const chat = app.activeChat;
  const [deepThinking, setDeepThinking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // For a new chat: the saved choice if it is still available, else the first featured model.
  const fallback = models.find((m) => m.featured) ?? models[0];
  const newChatModel: ModelChoice | null =
    findModel(models, app.model) || !fallback
      ? app.model
      : { provider: fallback.provider, model: fallback.id };
  const choice: ModelChoice | null = chat ? { provider: chat.provider, model: chat.model } : newChatModel;
  const current = findModel(models, choice);
  const streaming = chat ? app.isStreaming(chat.id) : false;
  const assistant = app.assistants.find(
    (a) => a.id === (chat ? chat.assistantId : app.draftAssistantId),
  );
  const noProviders = data !== null && models.length === 0;

  // Follow the answer while it streams, unless the user scrolled up to read.
  const lastMessage = chat?.messages[chat.messages.length - 1];
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastMessage?.content, lastMessage?.reasoning, chat?.messages.length]);

  useEffect(() => {
    stickToBottom.current = true;
  }, [chat?.id]);

  const onPick = (c: ModelChoice) => (chat ? app.setChatModel(chat.id, c) : app.setModel(c));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3 pl-14 md:pl-3">
        <ModelPicker models={models} value={choice} onChange={onPick} loading={loading} />
        {assistant && (
          <span className="flex items-center gap-1.5 rounded-full bg-violet-500/15 px-3 py-1 text-xs text-violet-200">
            <span>{assistant.emoji}</span>
            {assistant.name}
            {!chat && (
              <button
                type="button"
                onClick={() => app.startChatWith(null)}
                className="ml-0.5 text-violet-300 hover:text-white"
                title="Без ассистента"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {chat ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6">
            {chat.messages.map((m, i) => (
              <MessageView
                key={m.id}
                message={m}
                models={models}
                isLast={i === chat.messages.length - 1}
                streaming={streaming && i === chat.messages.length - 1}
                onRegenerate={() => app.regenerate(chat.id, deepThinking)}
              />
            ))}
          </div>
        ) : (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-4 py-10">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-2xl shadow-lg shadow-violet-500/30">
              {assistant?.emoji ?? <Sparkles className="size-7 text-white" />}
            </div>
            <h1 className="mb-2 text-center text-2xl font-semibold text-zinc-100 md:text-3xl">
              {assistant ? assistant.name : "Чем могу помочь?"}
            </h1>
            <p className="mb-8 text-center text-sm text-zinc-400">
              {assistant?.description ||
                "Чат с лучшими моделями мира — Claude, GPT, Gemini, Llama, DeepSeek и другими."}
            </p>

            {noProviders ? (
              <div className="w-full max-w-lg rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-100">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <KeyRound className="size-4" /> Подключите хотя бы одного провайдера
                </div>
                <p className="mb-3 text-amber-100/80">
                  Добавьте API-ключ (например, ANTHROPIC_API_KEY или OPENAI_API_KEY) в файл
                  <code className="mx-1 rounded bg-black/30 px-1">.env.local</code>и перезапустите
                  сервер.
                </p>
                <Link href="/settings" className="font-medium text-amber-200 underline">
                  Открыть настройки →
                </Link>
              </div>
            ) : (
              <div className="grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    disabled={!current}
                    onClick={() => app.send(s.text, [], deepThinking, choice)}
                    className="rounded-2xl border border-white/10 p-4 text-left transition hover:bg-white/5 disabled:opacity-50"
                  >
                    <div className="text-sm font-medium text-zinc-200">{s.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-zinc-500">{s.text}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 pb-3 pt-1 md:px-4">
        <Composer
          model={current}
          disabled={!choice || noProviders || !app.ready}
          streaming={streaming}
          deepThinking={deepThinking}
          onDeepThinkingChange={setDeepThinking}
          onSend={(text, attachments) => {
            stickToBottom.current = true;
            app.send(text, attachments, deepThinking, choice);
          }}
          onStop={() => chat && app.stop(chat.id)}
        />
        <p className="mt-2 text-center text-[11px] text-zinc-600">
          ИИ может ошибаться. Проверяйте важную информацию.
        </p>
      </div>
    </div>
  );
}
