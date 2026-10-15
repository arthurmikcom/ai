"use client";

import { ArrowRight, ArrowUpRight, Clapperboard, Code2, Compass, FileText, Image as ImageIcon, KeyRound, Lightbulb, LoaderCircle, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useModels } from "@/lib/client/useModels";
import { useApp, type ModelChoice } from "../AppState";
import { findModel, ModelPicker } from "../ModelPicker";
import { Composer } from "./Composer";
import { MessageView } from "./MessageView";
import { NexusVisual } from "../Design";

const SUGGESTIONS = [
  { title: "Объясни просто", icon: Sparkles, text: "Объясни, как работают нейросети, как будто мне 12 лет" },
  { title: "Напиши код", icon: Code2, text: "Напиши на Python скрипт, который переименовывает фото по дате съёмки" },
  { title: "Составь план", icon: Compass, text: "Составь план запуска своего онлайн-сервиса за 30 дней" },
  { title: "Придумай идеи", icon: Lightbulb, text: "Придумай 10 идей для AI-стартапа с описанием и монетизацией" },
];

const ASSISTANT_LINKS = [
  { name: "Программист", emoji: "💻", detail: "Код и сложные задачи" },
  { name: "Переводчик", emoji: "🌐", detail: "Слова без границ" },
  { name: "Копирайтер", emoji: "✍️", detail: "Тексты с характером" },
  { name: "Репетитор", emoji: "🎓", detail: "Английский каждый день" },
  { name: "Бизнес-аналитик", emoji: "📊", detail: "От идеи к стратегии" },
  { name: "Шеф-повар", emoji: "👨‍🍳", detail: "Вдохновение на кухне" },
];

export function ChatView() {
  const app = useApp();
  const { data, loading } = useModels("chat");
  const models = useMemo(() => data?.models ?? [], [data]);
  const chat = app.activeChat;
  const [deepThinking, setDeepThinking] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  // Drawing in the chat needs at least one image model on the server.
  const images = useModels("image");
  const canDraw = Boolean(images.data?.models.length);
  // Answers name their model; pictures come from image models.
  const allModels = useMemo(() => [...models, ...(images.data?.models ?? [])], [models, images.data]);
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
    if (el && chat?.id && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat?.id, lastMessage?.content, lastMessage?.reasoning, chat?.messages.length]);

  useEffect(() => {
    stickToBottom.current = true;
    if (!chat?.id) scroller.current?.scrollTo({ top: 0 });
  }, [chat?.id]);

  const onPick = (c: ModelChoice) => (chat ? app.setChatModel(chat.id, c) : app.setModel(c));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="chat-header flex shrink-0 items-center gap-2 px-4 md:px-8">
        <ModelPicker models={models} value={choice} onChange={onPick} loading={loading} />
        <span className="ml-auto hidden items-center gap-2 text-[11px] text-zinc-500 lg:flex">Ваш личный диалог</span>
        <Link href="/settings" aria-label="Открыть профиль" className="profile-shortcut ml-auto lg:ml-3">{(app.me?.user.name || "N").slice(0, 1).toUpperCase()}</Link>
        {assistant && (
          <span className="flex min-w-0 max-w-[45%] items-center gap-1.5 rounded-full bg-violet-500/15 px-3 py-1 text-xs text-violet-200">
            <span>{assistant.emoji}</span>
            <span className="min-w-0 truncate" title={assistant.name}>{assistant.name}</span>
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
        {chat && !chat.loaded ? (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle className="size-6 animate-spin text-zinc-500" />
          </div>
        ) : chat ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6">
            {chat.messages.map((m, i) => (
              <MessageView
                key={m.id}
                message={m}
                models={allModels}
                isLast={i === chat.messages.length - 1}
                streaming={streaming && i === chat.messages.length - 1}
                onRegenerate={() =>
                  app.regenerate(chat.id, {
                    deepThinking,
                    image: Boolean(m.attachments?.length),
                    webSearch: webSearch && Boolean(current?.search),
                  })
                }
              />
            ))}
          </div>
        ) : (
          <div className="home-dashboard">
            <div className="home-hero">
              <div className="home-intro">
                <div className="section-label mb-4">{assistant ? "Ваш персональный ассистент" : "Добро пожаловать в"}</div>
                <h1>{assistant ? <>{assistant.emoji} {assistant.name}</> : <>Nexus <span>AI</span></>}</h1>
                <p>{assistant?.description || <>Лучшие модели мира.<br />Безграничные возможности.</>}</p>
                <div className="provider-pills" aria-label="Модели в Nexus AI">
                  {["GPT", "Claude", "Gemini", "Llama", "DeepSeek"].map(name => <span key={name}>{name}</span>)}
                </div>
              </div>
              <div className="home-art" aria-hidden="true">
                <NexusVisual />
                <span className="orb-label orb-label-text"><FileText className="size-4" />Тексты</span>
                <span className="orb-label orb-label-image"><ImageIcon className="size-4" />Изображения</span>
                <span className="orb-label orb-label-video"><Clapperboard className="size-4" />Видео</span>
                <span className="orb-label orb-label-code"><Code2 className="size-4" />Код</span>
              </div>
            </div>

            {noProviders && (
              <div className="empty-notice mb-5 w-full rounded-2xl border p-4 text-xs text-zinc-300">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <KeyRound className="size-4" /> Модели ещё не подключены
                </div>
                {app.me?.admin ? (
                  <>
                    <p className="mb-3 text-zinc-400">
                      Добавьте API-ключ (например, ANTHROPIC_API_KEY или OPENAI_API_KEY) в переменные
                      окружения сервера и перезапустите его.
                    </p>
                    <Link href="/settings" className="font-medium text-violet-200 underline">
                      Открыть настройки →
                    </Link>
                  </>
                ) : (
                  <p className="text-zinc-400">Сервис настраивается. Загляните чуть позже.</p>
                )}
            <div className="home-actions">
              {SUGGESTIONS.slice(0, 2).map((s, index) => (
                <button key={s.title} type="button" disabled={!current || noProviders} onClick={() => app.send(s.text, [], { deepThinking, webSearch: webSearch && Boolean(current?.search) }, choice)} className={`home-action-card home-action-${index}`}>
                  <div className="home-action-top"><span className="home-action-icon"><s.icon className="size-6" /></span><ArrowUpRight className="size-4" /></div>
                  <h2>{s.title}</h2>
                  <p className="line-clamp-3">{s.text}</p>
                </button>
              ))}
              <Link href="/images" className="home-action-card home-action-2">
                <div className="home-action-top"><span className="home-action-icon"><ImageIcon className="size-6" /></span><ArrowUpRight className="size-4" /></div>
                <h2>Создай изображение</h2><p>Из идеи в визуал — по вашему описанию.</p>
              </Link>
              <Link href="/video" className="home-action-card home-action-3">
                <div className="home-action-top"><span className="home-action-icon"><Clapperboard className="size-6" /></span><ArrowUpRight className="size-4" /></div>
                <h2>Сгенерируй видео</h2><p>Сцены и новые миры, которые оживают.</p>
              </Link>
            </div>

            <div className="home-extra-prompts">
              <span>Ещё идеи:</span>
              {SUGGESTIONS.slice(2).map(s => (
                <button key={s.title} type="button" title={s.text} disabled={!current || noProviders} onClick={() => app.send(s.text, [], { deepThinking, webSearch: webSearch && Boolean(current?.search) }, choice)}><s.icon className="size-3.5" />{s.title}</button>
              ))}
            </div>

            <section className="home-assistants">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <Link href="/assistants" className="flex items-center gap-2 text-base font-medium text-zinc-100">Мои ассистенты <ArrowRight className="size-4 text-zinc-500" /></Link>
                <Link href="/assistants" className="flex items-center gap-2 text-xs text-zinc-400 hover:text-violet-200"><Plus className="size-4" />Создать ассистента</Link>
              </div>
              <div className="assistant-shortcuts">
                {ASSISTANT_LINKS.map(a => <Link key={a.name} href="/assistants" className="assistant-shortcut"><span className="assistant-shortcut-icon" aria-hidden="true">{a.emoji}</span><span><strong>{a.name}</strong><small>{a.detail}</small></span></Link>)}
              </div>
              <p className="mt-2 text-[10px] text-zinc-500">Готовые шаблоны — настройте под себя в разделе ассистентов.</p>
            </section>

              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2 md:px-8 md:pb-5">
        <Composer
          model={current}
          disabled={!choice || noProviders || !app.ready}
          streaming={streaming}
          deepThinking={deepThinking}
          onDeepThinkingChange={setDeepThinking}
          webSearch={webSearch && Boolean(current?.search)}
          onWebSearchChange={setWebSearch}
          canDraw={canDraw}
          imageMode={imageMode && canDraw}
          onImageModeChange={setImageMode}
          onSend={(text, attachments) => {
            stickToBottom.current = true;
            app.send(
              text,
              attachments,
              { deepThinking, image: imageMode && canDraw, webSearch: webSearch && Boolean(current?.search) },
              choice,
            );
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
