"use client";

import { ArrowRight, ArrowUpRight, Clapperboard, Code2, Compass, FileText, Gamepad2, Image as ImageIcon, KeyRound, Lightbulb, LoaderCircle, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BROWSER_MODELS } from "@/lib/catalog";
import { autoModel, useLocalSupport } from "@/lib/client/local-ai";
import { useModels } from "@/lib/client/useModels";
import { imageToAttachment, uid } from "@/lib/client/util";
import type { Attachment, SendOptions } from "@/lib/types";
import { speak, stopSpeaking, useVoiceSupport } from "@/lib/client/voice";
import { useApp, type ModelChoice } from "../AppState";
import { findModel, MaryxBadge, ModelPicker } from "../ModelPicker";
import { Composer, type ComposerInject } from "./Composer";
import { MessageView } from "./MessageView";
import { MaryxVisual } from "../Design";

const SUGGESTIONS = [
  { title: "Объясни просто", icon: Sparkles, text: "Объясни, как работают нейросети, как будто мне 12 лет" },
  // The answer runs right in the chat ("Запустить").
  { title: "Сделай игру", icon: Gamepad2, text: "Сделай игру «Змейка» с красивым неоновым дизайном, счётом и управлением стрелками и свайпами" },
  { title: "Составь план", icon: Compass, text: "Составь план запуска своего онлайн-сервиса за 30 дней" },
  { title: "Придумай идеи", icon: Lightbulb, text: "Придумай 10 идей для AI-стартапа с описанием и монетизацией" },
  { title: "Напиши код", icon: Code2, text: "Напиши на Python скрипт, который переименовывает фото по дате съёмки" },
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
  const { data, loading, error: modelsError } = useModels("chat");
  const models = useMemo(() => data?.models ?? [], [data]);
  const chat = app.activeChat;
  const [deepThinking, setDeepThinking] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const voice = useVoiceSupport();
  // Dictation runs on our server when it can (works in every browser); else the browser's own.
  const voiceInput =
    voice?.record && app.me?.voice.transcribe ? "server" : voice?.recognize ? "browser" : null;
  // A message sent by voice in talk mode gets its answer read aloud (in that chat only).
  const speakNext = useRef<string | null>(null);
  // Drawing in the chat needs at least one image model on the server.
  const images = useModels("image");
  const canDraw = Boolean(images.data?.models.length);
  // …and one that edits photos, for photos attached in "draw" mode.
  const canEditPhotos = Boolean(images.data?.models.some((m) => m.photoEdit));
  // Videos in the chat need a video model (and one that starts from a photo, to animate one).
  const videos = useModels("video");
  const [videoMode, setVideoMode] = useState(false);
  const [camera, setCamera] = useState<string | null>(null);
  const [style, setStyle] = useState<string | null>(null);
  // Answers name their model; pictures and clips come from image and video models.
  const allModels = useMemo(
    () => [...models, ...(images.data?.models ?? []), ...(videos.data?.models ?? [])],
    [models, images.data, videos.data],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // A chat picture put into the composer to be changed.
  const [inject, setInject] = useState<ComposerInject | null>(null);

  // Only MARYX is offered: every chat, old ones too, talks to it.
  const only = app.maryxOnly;
  const MARYX: ModelChoice = { provider: "maryx", model: "maryx" };
  // For a new chat: the saved choice if it is still available, else the first featured model.
  const fallback = models.find((m) => m.featured) ?? models[0];
  const newChatModel: ModelChoice | null = only
    ? MARYX
    : findModel(models, app.model) || !fallback
      ? app.model
      : { provider: fallback.provider, model: fallback.id };
  const choice: ModelChoice | null = chat ? (only ? MARYX : { provider: chat.provider, model: chat.model }) : newChatModel;
  const current = findModel(models, choice);
  const streaming = chat ? app.isStreaming(chat.id) : false;
  const assistant = app.assistants.find(
    (a) => a.id === (chat ? chat.assistantId : app.draftAssistantId),
  );
  const noProviders = data !== null && models.length === 0;
  // No cloud model on the server: MARYX and the Qwen models run in this browser.
  const noServerModels =
    data !== null &&
    (only ? Boolean(models.find((m) => m.provider === "maryx")?.local) : !models.some((m) => !m.local && m.provider !== "maryx"));
  const localSupportState = useLocalSupport();
  const localModel = current?.local ? (current.provider === "browser" ? current.id : autoModel(localSupportState)) : undefined;
  // A browser model can't be used until this browser is checked, nor where it can't run.
  const localBlocked = Boolean(current?.local && (!localSupportState || !localSupportState.ok));
  const canFilm = Boolean(videos.data?.models.length) && !current?.local;
  const canAnimate = canFilm && Boolean(videos.data?.models.some((m) => m.photoEdit));
  const localLabel = BROWSER_MODELS.find((m) => m.id === localModel);
  /** What every send uses: the toggles, and the browser model when the chosen one runs here. */
  const sendOptions = (extra: Partial<SendOptions> = {}): SendOptions => ({
    // Kept while switching models, but sent only to one that can think.
    deepThinking: deepThinking && Boolean(current?.reasoning),
    webSearch: webSearch && Boolean(current?.search),
    ...extra,
    ...(localModel ? { image: false, video: false, local: { model: localModel } } : {}),
  });
  const disabledText =
    !app.ready || loading
      ? "Загружаю модели…"
      : localBlocked
        ? (localSupportState?.reason ?? "Проверяю, умеет ли браузер запускать ИИ на устройстве…")
        : modelsError
        ? "Не удалось загрузить список моделей — обновите страницу"
        : noProviders
          ? app.me?.admin
            ? "Нейросети не подключены: нужен ключ OPENROUTER_API_KEY на сервере"
            : "Нейросети пока не подключены — загляните чуть позже"
          : only
            ? "MARYX сейчас недоступен — обновите страницу"
            : choice
              ? "Модель этого чата недоступна — выберите другую вверху"
              : "Выберите модель вверху";

  // Follow the answer while it streams, unless the user scrolled up to read.
  const lastMessage = chat?.messages[chat.messages.length - 1];
  useEffect(() => {
    const el = scroller.current;
    if (el && chat?.id && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat?.id, lastMessage?.content, lastMessage?.reasoning, lastMessage?.suggestions, streaming, chat?.messages.length]);

  useEffect(() => {
    stickToBottom.current = true;
    if (!chat?.id) scroller.current?.scrollTo({ top: 0 });
  }, [chat?.id]);

  // Pictures and videos load (and grow) after the answer arrived: stay at the bottom while following it.
  const threadShown = Boolean(chat?.loaded);
  useEffect(() => {
    const el = scroller.current;
    const inner = thread.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [chat?.id, threadShown]);

  // Switching chats (or leaving the page) stops reading aloud.
  useEffect(() => () => stopSpeaking(), [chat?.id]);

  // Talk mode: read the answer aloud once it has finished streaming — in the chat it
  // was asked in (a brand-new chat gets its id only after sending), unless stopped.
  useEffect(() => {
    const target = speakNext.current;
    if (!target || streaming || !lastMessage || !chat) return;
    if (target !== chat.id && target !== "new") {
      speakNext.current = null;
      return;
    }
    if (lastMessage.role !== "assistant") return;
    speakNext.current = null;
    if (lastMessage.content && !lastMessage.error && !lastMessage.notice?.includes("остановлена")) {
      speak(lastMessage.id, lastMessage.content);
    }
  }, [streaming, lastMessage, chat]);

  const onPick = (c: ModelChoice) => (chat ? app.setChatModel(chat.id, c) : app.setModel(c));

  // Nano Banana style: a picture in the chat is changed further (with an effect right away, or in
  // words), or brought to life as a video.
  const canChangePictures = canEditPhotos && !current?.local && !localBlocked && !noProviders && !streaming;
  const canAnimatePictures = canAnimate && !localBlocked && !noProviders && !streaming;
  const pictureFrom = async (src: string) => {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      const photo = await imageToAttachment(await res.blob());
      return { mime: photo.mime, data: photo.data, name: "Картинка" };
    } catch {
      setInject({ id: uid(), attachments: [], error: "Не удалось загрузить картинку — попробуйте ещё раз." });
      return null;
    }
  };
  const sendNow = (text: string, attachments: Attachment[], options: Partial<SendOptions>) => {
    stickToBottom.current = true;
    stopSpeaking();
    app.send(text, attachments, sendOptions(options), choice);
  };
  const editPicture = async (src: string, prompt?: string) => {
    const picture = await pictureFrom(src);
    if (!picture) return;
    if (prompt) return sendNow(prompt, [picture], { image: true });
    setVideoMode(false);
    setImageMode(true);
    setInject({ id: uid(), attachments: [picture] });
  };
  const animatePicture = async (src: string) => {
    const picture = await pictureFrom(src);
    if (picture) sendNow("Оживи это фото", [picture], { video: true, camera: camera ?? undefined });
  };
  const changeImageMode = (on: boolean) => {
    setImageMode(on);
    if (on) setVideoMode(false);
  };
  const changeVideoMode = (on: boolean) => {
    setVideoMode(on);
    if (on) setImageMode(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="chat-header flex shrink-0 items-center gap-2 px-4 md:px-8">
        {only ? <MaryxBadge /> : <ModelPicker models={models} value={choice} onChange={onPick} loading={loading} />}
        <span className="ml-auto hidden items-center gap-2 text-[11px] text-zinc-500 lg:flex">Ваш личный диалог</span>
        <Link href="/settings" aria-label="Открыть профиль" className="profile-shortcut ml-auto lg:ml-3">{(app.me?.user.name || "M").slice(0, 1).toUpperCase()}</Link>
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
          <div ref={thread} className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6">
            {chat.messages.map((m, i) => (
              <MessageView
                key={m.id}
                message={m}
                models={allModels}
                maryxOnly={only}
                isLast={i === chat.messages.length - 1}
                streaming={streaming && i === chat.messages.length - 1}
                onEditPicture={canChangePictures ? (src, prompt) => void editPicture(src, prompt) : undefined}
                onAnimatePicture={canAnimatePictures ? (src) => void animatePicture(src) : undefined}
                onSuggest={
                  noProviders || localBlocked
                    ? undefined
                    : (text) => {
                        stickToBottom.current = true;
                        stopSpeaking();
                        app.send(text, [], sendOptions(), choice);
                      }
                }
                onRegenerate={localBlocked ? undefined : () =>
                  app.regenerate(
                    chat.id,
                    sendOptions(
                      // A video answer is made again as a video.
                      m.mediaId || m.generating === "video" || videos.data?.models.some((x) => x.provider === m.provider && x.id === m.model)
                        ? { video: true }
                        : {
                            // Redraw a picture — also one that failed or was stopped (its model is an image model).
                            image:
                              m.generating === "image" ||
                              Boolean(m.attachments?.length) ||
                              Boolean(images.data?.models.some((x) => x.provider === m.provider && x.id === m.model)),
                          },
                    ),
                  )
                }
              />
            ))}
          </div>
        ) : (
          <div className="home-dashboard">
            <div className="home-hero">
              <div className="home-intro">
                <div className="section-label mb-4">{assistant ? "Ваш персональный ассистент" : "Добро пожаловать в"}</div>
                <h1>{assistant ? <>{assistant.emoji} {assistant.name}</> : <>MARYX <span>Ai</span></>}</h1>
                <p>
                  {assistant?.description ||
                    (only ? <>Ваш собственный ИИ.<br />Безграничные возможности.</> : <>Лучшие модели мира.<br />Безграничные возможности.</>)}
                </p>
                {!only && (
                  <div className="provider-pills" aria-label="Модели в MARYX Ai">
                    {["GPT", "Claude", "Gemini", "Llama", "DeepSeek"].map(name => <span key={name}>{name}</span>)}
                  </div>
                )}
              </div>
              <div className="home-art" aria-hidden="true">
                <MaryxVisual />
                <span className="orb-label orb-label-text"><FileText className="size-4" />Тексты</span>
                <span className="orb-label orb-label-image"><ImageIcon className="size-4" />Изображения</span>
                <span className="orb-label orb-label-video"><Clapperboard className="size-4" />Видео</span>
                <span className="orb-label orb-label-code"><Code2 className="size-4" />Код</span>
              </div>
            </div>

            {(noProviders || noServerModels) && (noProviders || app.me?.admin) && (
              <div className="empty-notice mb-5 w-full rounded-2xl border p-4 text-xs text-zinc-300">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <KeyRound className="size-4" />
                  {noProviders ? "Модели ещё не подключены" : "Работает бесплатный Qwen в браузере"}
                </div>
                {app.me?.admin ? (
                  <>
                    <p className="mb-3 text-zinc-400">
                      MARYX отвечает моделью Qwen прямо на устройстве посетителя — бесплатно, но она слабее облачных.
                      Для Claude, GPT, Gemini, Qwen Max, картинок и видео добавьте OPENROUTER_API_KEY в Vercel
                      (Settings → Environment Variables, для Production) и сделайте Redeploy.
                    </p>
                    <a href="/api/health" target="_blank" rel="noreferrer" className="font-medium text-violet-200 underline">
                      Проверить настройку сервера →
                    </a>
                  </>
                ) : (
                  <p className="text-zinc-400">Сервис настраивается. Загляните чуть позже.</p>
                )}
              </div>
            )}
            <div className="home-actions">
              {SUGGESTIONS.slice(0, 2).map((s, index) => (
                <button key={s.title} type="button" disabled={!app.ready || !current || noProviders || localBlocked} onClick={() => app.send(s.text, [], sendOptions(), choice)} className={`home-action-card home-action-${index}`}>
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
                <button key={s.title} type="button" title={s.text} disabled={!app.ready || !current || noProviders || localBlocked} onClick={() => app.send(s.text, [], sendOptions(), choice)}><s.icon className="size-3.5" />{s.title}</button>
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

      <div className="shrink-0 px-4 pb-4 pt-2 md:px-8 md:pb-5">
        <Composer
          model={current}
          disabled={!choice || !current || noProviders || !app.ready || loading || localBlocked}
          disabledText={disabledText}
          allowFiles={!current?.local}
          streaming={streaming}
          deepThinking={deepThinking}
          onDeepThinkingChange={setDeepThinking}
          webSearch={webSearch && Boolean(current?.search)}
          onWebSearchChange={setWebSearch}
          canDraw={canDraw && !current?.local}
          canEditPhotos={canEditPhotos}
          imageMode={imageMode && canDraw && !current?.local}
          onImageModeChange={changeImageMode}
          canFilm={canFilm}
          canAnimate={canAnimate}
          videoMode={videoMode && canFilm}
          onVideoModeChange={changeVideoMode}
          camera={camera}
          onCameraChange={setCamera}
          style={style}
          onStyleChange={setStyle}
          voiceInput={voiceInput}
          voiceMode={voiceMode && Boolean(voice?.speak)}
          onVoiceModeChange={voice?.speak ? setVoiceMode : null}
          onSend={(text, attachments, viaVoice) => {
            stickToBottom.current = true;
            stopSpeaking();
            speakNext.current = viaVoice && voiceMode && voice?.speak ? (chat?.id ?? "new") : null;
            const filming = videoMode && canFilm;
            const drawing = !filming && imageMode && canDraw && !current?.local;
            app.send(
              text,
              attachments,
              sendOptions({
                image: drawing,
                video: filming,
                camera: filming ? (camera ?? undefined) : undefined,
                style: drawing ? (style ?? undefined) : undefined,
              }),
              choice,
            );
          }}
          onStop={() => {
            speakNext.current = null;
            if (chat) app.stop(chat.id);
          }}
          inject={inject}
        />
        <p className="mt-2 text-center text-[11px] text-zinc-600">
          {current?.local && !localBlocked
            ? only
              ? `Бесплатно: MARYX отвечает прямо на вашем устройстве; история чата хранится в вашем аккаунте. В первый раз он скачается (≈${((localLabel?.downloadMB ?? 1000) / 1000).toFixed(1).replace(".", ",")} ГБ).`
              : `Бесплатно: отвечает ${localLabel?.label ?? "Qwen"} прямо на вашем устройстве, без сторонних ИИ-сервисов; история чата хранится в вашем аккаунте. В первый раз модель скачается (≈${((localLabel?.downloadMB ?? 1000) / 1000).toFixed(1).replace(".", ",")} ГБ).`
            : "ИИ может ошибаться. Проверяйте важную информацию."}
        </p>
      </div>
    </div>
  );
}
