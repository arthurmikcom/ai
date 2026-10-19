"use client";

import {
  ArrowUp,
  AudioLines,
  Brain,
  Clapperboard,
  FileText,
  Globe,
  LoaderCircle,
  Mic,
  Palette,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ApiError } from "@/lib/client/api";
import {
  ATTACH_ACCEPT,
  documentMime,
  documentToAttachment,
  imageToAttachment,
  isDocumentAttachment,
  MAX_TOTAL_BASE64,
} from "@/lib/client/util";
import {
  primeSpeech,
  recognizeOnce,
  startRecording,
  stopSpeaking,
  transcribe,
  type Recording,
} from "@/lib/client/voice";
import { CAMERA_MOTIONS, PHOTO_EFFECTS } from "@/lib/effects";
import type { Attachment, ModelInfo } from "@/lib/types";

interface Props {
  model: ModelInfo | undefined;
  disabled: boolean;
  /** Why the field is disabled, shown in place of the hint. */
  disabledText?: string;
  /** Files can be attached (models in the browser read text only). */
  allowFiles?: boolean;
  streaming: boolean;
  deepThinking: boolean;
  onDeepThinkingChange: (value: boolean) => void;
  /** Search the web while answering (models with `search`). */
  webSearch: boolean;
  onWebSearchChange: (value: boolean) => void;
  /** An image model is available, so the "draw" toggle can be offered. */
  canDraw: boolean;
  /** An image model edits photos: in "draw" mode, attached photos are what it edits. */
  canEditPhotos?: boolean;
  /** The next message is a picture description, not a question. */
  imageMode: boolean;
  onImageModeChange: (value: boolean) => void;
  /** A video model is available, so the "video" toggle can be offered. */
  canFilm?: boolean;
  /** A video model starts from a photo: in "video" mode, an attached photo is brought to life. */
  canAnimate?: boolean;
  /** The next message describes a video (or how to animate the attached photo). */
  videoMode?: boolean;
  onVideoModeChange?: (value: boolean) => void;
  /** Video mode: how the camera moves (an id of CAMERA_MOTIONS), or null. */
  camera?: string | null;
  onCameraChange?: (value: string | null) => void;
  /** How dictation is recognized: on our server, by the browser, or not at all. */
  voiceInput: "server" | "browser" | null;
  /** Talk mode: dictated messages are sent right away and answers are read aloud. */
  voiceMode: boolean;
  onVoiceModeChange: ((value: boolean) => void) | null;
  onSend: (text: string, attachments: Attachment[], viaVoice?: boolean) => void;
  onStop: () => void;
  /** Pictures put in from the chat ("Изменить" under a picture); taken once per `id`. */
  inject?: ComposerInject | null;
}

export interface ComposerInject {
  id: string;
  attachments: Attachment[];
  /** Why the picture couldn't be put in. */
  error?: string;
}

const MAX_ATTACHMENTS = 4;

export function Composer({
  model,
  disabled,
  disabledText,
  allowFiles = true,
  streaming,
  deepThinking,
  onDeepThinkingChange,
  webSearch,
  onWebSearchChange,
  canDraw,
  canEditPhotos = false,
  imageMode,
  onImageModeChange,
  canFilm = false,
  canAnimate = false,
  videoMode = false,
  onVideoModeChange,
  camera = null,
  onCameraChange,
  voiceInput,
  voiceMode,
  onVoiceModeChange,
  onSend,
  onStop,
  inject = null,
}: Props) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const recording = useRef<Recording | null>(null);
  const recognizer = useRef<{ stop: () => void } | null>(null);
  // Set before the microphone permission prompt, so a second tap can't open another recorder.
  const starting = useRef(false);
  const alive = useRef(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // A picture to change goes first: the first photo is the one that is edited.
  const [injected, setInjected] = useState(inject?.id);
  if (inject && inject.id !== injected) {
    setInjected(inject.id);
    setAttachments((list) => [...inject.attachments, ...list].slice(0, MAX_ATTACHMENTS));
    setError(inject.error ?? null);
  }
  useEffect(() => {
    if (inject) textarea.current?.focus();
  }, [inject]);

  // Documents work with any model; pictures need one that can see. In "draw" mode only photos (to edit) go
  // along, in "video" mode one photo (the clip's first frame).
  const editPhotos = imageMode && canEditPhotos;
  const takesPhotos = editPhotos || (videoMode && canAnimate);
  const mediaMode = imageMode || videoMode;
  const canAttach = allowFiles && (!mediaMode || takesPhotos);
  /** Whether a file can go with this message; the others stay in the composer (drawing, or a text-only model). */
  const goes = (a: Attachment) => allowFiles && (!mediaMode || (takesPhotos && !isDocumentAttachment(a)));
  const going = attachments.filter(goes);
  const sending = videoMode ? going.slice(0, 1) : going;
  const keeping = attachments.filter((a) => !sending.includes(a));
  const canSeeImages = model?.vision !== false || takesPhotos;
  const canSend = !disabled && !streaming && (text.trim() !== "" || sending.length > 0);

  const addFiles = async (files: File[]) => {
    setError(null);
    const room = MAX_ATTACHMENTS - attachments.length;
    const problems: string[] = [];
    const added: Attachment[] = [];
    let total = attachments.reduce((sum, a) => sum + (a.data?.length ?? 0), 0);
    for (const file of files.slice(0, room)) {
      try {
        if (file.type.startsWith("image/")) {
          if (!canSeeImages) {
            problems.push("Эта модель не видит изображения — выберите другую модель.");
            continue;
          }
          const image = await imageToAttachment(file);
          if (total + (image.data?.length ?? 0) > MAX_TOTAL_BASE64) {
            problems.push("Вложения слишком большие: всего до 3 МБ за сообщение.");
            continue;
          }
          total += image.data?.length ?? 0;
          added.push(image);
        } else if (documentMime(file)) {
          const doc = await documentToAttachment(file);
          if (!doc) problems.push(`«${file.name}» больше 3 МБ.`);
          else if (total + (doc.data?.length ?? 0) > MAX_TOTAL_BASE64) {
            problems.push("Вложения слишком большие: всего до 3 МБ за сообщение.");
          } else {
            total += doc.data?.length ?? 0;
            added.push(doc);
          }
        } else {
          problems.push(`«${file.name}»: такой тип файла пока не поддерживается.`);
        }
      } catch {
        problems.push(`Не удалось прочитать «${file.name}».`);
      }
    }
    if (files.length > room) problems.push(`Не больше ${MAX_ATTACHMENTS} файлов за раз.`);
    setAttachments((a) => [...a, ...added]);
    if (problems.length) setError(problems.join(" "));
  };

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), sending);
    setText("");
    // A picture prompt (or a text-only model) doesn't take the other files along; they stay for later.
    setAttachments(keeping);
    setError(null);
    if (textarea.current) textarea.current.style.height = "auto";
  };

  // Stop the microphone if the composer goes away mid-recording.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      recording.current?.cancel();
      recognizer.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (listening !== "recording") return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [listening]);

  const applyDictation = (spoken: string) => {
    if (!spoken) {
      setError("Не удалось разобрать речь. Попробуйте ещё раз.");
      return;
    }
    if (voiceMode && !disabled && !streaming) {
      onSend(spoken, sending, true);
      setAttachments(keeping);
      return;
    }
    setText((t) => (t.trim() ? `${t.trimEnd()} ${spoken}` : spoken));
    textarea.current?.focus();
  };

  const finishRecording = async () => {
    const current = recording.current;
    if (!current) return;
    recording.current = null;
    setListening("transcribing");
    try {
      applyDictation(await transcribe(await current.stop()));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    }
    setListening("idle");
  };

  const toggleMic = async () => {
    setError(null);
    // Don't read an answer aloud over the user, and let iOS speak later.
    stopSpeaking();
    primeSpeech();
    if (listening === "recording") {
      if (recognizer.current) recognizer.current.stop();
      else await finishRecording();
      return;
    }
    if (listening !== "idle" || !voiceInput || starting.current) return;
    setSeconds(0);
    if (voiceInput === "browser") {
      const session = recognizeOnce();
      recognizer.current = session;
      setListening("recording");
      try {
        applyDictation(await session.result);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      recognizer.current = null;
      setListening("idle");
      return;
    }
    starting.current = true;
    try {
      const rec = await startRecording(() => void finishRecording());
      // The composer went away (or another recording began) while permission was asked.
      if (!alive.current || recording.current) rec.cancel();
      else {
        recording.current = rec;
        setListening("recording");
      }
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setError(denied ? "Разрешите доступ к микрофону в настройках браузера." : "Микрофон недоступен.");
    }
    starting.current = false;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length && canAttach) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="composer-panel rounded-3xl border p-3 transition-colors">
        {keeping.length > 0 && (
          <p className="px-2 pt-1 text-xs text-zinc-500">
            {!allowFiles
              ? "ИИ на вашем устройстве читает только текст — файлы не отправятся и останутся для следующего сообщения."
              : videoMode
                ? takesPhotos
                  ? "В режиме «Видео» отправляется одно фото — первое. Остальные файлы останутся для следующего сообщения."
                  : "В режиме «Видео» файлы не отправляются — они останутся для следующего сообщения."
                : editPhotos
                  ? "В режиме «Картинка» документы не отправляются — только фото. Они останутся для следующего сообщения."
                  : "В режиме «Картинка» файлы не отправляются — они останутся для следующего сообщения."}
          </p>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2">
            {attachments.map((a, i) => (
              <div key={i} className={`relative ${sending.includes(a) ? "" : "opacity-40"}`}>
                {isDocumentAttachment(a) ? (
                  <div className="flex h-16 max-w-52 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs text-zinc-300">
                    <FileText className="size-5 shrink-0 text-violet-300" />
                    <span className="line-clamp-2 break-all">{a.name}</span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- local data URL
                  <img
                    src={`data:${a.mime};base64,${a.data}`}
                    alt={a.name ?? ""}
                    className="size-16 rounded-xl object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-700 p-0.5 text-zinc-200 hover:bg-zinc-600"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {editPhotos && sending.length > 0 && !text.trim() && (
          <div role="group" aria-label="Эффекты" className="flex flex-wrap gap-1.5 px-2 pb-1">
            {PHOTO_EFFECTS.map((e) => (
              <button
                key={e.id}
                type="button"
                title={e.prompt}
                onClick={() => {
                  setText(e.prompt);
                  textarea.current?.focus();
                }}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300 transition hover:border-violet-300/40 hover:text-zinc-50"
              >
                <span aria-hidden="true">{e.emoji}</span> {e.label}
              </button>
            ))}
          </div>
        )}

        {videoMode && onCameraChange && (
          // One scrolling line on phones, so the text field keeps its room.
          <div role="group" aria-label="Движение камеры" className="flex items-center gap-1.5 overflow-x-auto px-2 pb-1 sm:flex-wrap">
            <span className="mr-0.5 shrink-0 text-xs text-zinc-500">Камера:</span>
            {CAMERA_MOTIONS.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={camera === m.id}
                onClick={() => onCameraChange(camera === m.id ? null : m.id)}
                className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-0.5 text-xs transition ${
                  camera === m.id
                    ? "border-violet-300/50 bg-violet-500/20 text-violet-100"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-violet-300/40 hover:text-zinc-100"
                }`}
              >
                <span aria-hidden="true">{m.emoji}</span> {m.label}
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={textarea}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={
            disabled
              ? (disabledText ?? "Загрузка…")
              : videoMode
                ? sending.length
                  ? "Как оживить фото? Например: улыбается и машет рукой. Можно оставить пустым"
                  : canAnimate
                    ? "Опишите видео — или прикрепите фото, чтобы оживить"
                    : "Опишите видео: что происходит, атмосфера, звук…"
                : imageMode
                  ? sending.length
                    ? "Что сделать с фото? Например: естественная ретушь, другой фон…"
                    : canEditPhotos
                      ? "Опишите картинку — или прикрепите фото, чтобы MARYX его обработал"
                      : "Опишите картинку: что на ней, стиль, настроение…"
                  : "Спросите что угодно…"
          }
          aria-label="Сообщение"
          disabled={disabled}
          className="max-h-60 w-full resize-none bg-transparent px-3 py-2 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
        />

        <div className="flex flex-wrap items-center gap-1 px-1">
          <input
            ref={fileInput}
            type="file"
            accept={takesPhotos ? "image/*" : ATTACH_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            title={
              videoMode
                ? takesPhotos
                  ? "Прикрепить фото, чтобы MARYX его оживил"
                  : "В режиме видео вложения не нужны"
                : imageMode
                  ? editPhotos
                    ? "Прикрепить фото, чтобы MARYX его обработал"
                    : "В режиме рисования вложения не нужны"
                  : !allowFiles
                  ? "ИИ на вашем устройстве читает только текст"
                  : canSeeImages
                  ? "Прикрепить файл: PDF, Word, Excel, CSV, TXT или изображение"
                  : "Прикрепить документ: PDF, Word, Excel, CSV, TXT"
            }
            disabled={!canAttach || disabled || attachments.length >= MAX_ATTACHMENTS}
            onClick={() => fileInput.current?.click()}
            className="rounded-full p-2 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100 disabled:opacity-40"
          >
            <Paperclip className="size-5" />
          </button>

          {voiceInput && (
            <button
              type="button"
              onClick={() => void toggleMic()}
              disabled={disabled || listening === "transcribing"}
              aria-pressed={listening === "recording"}
              title={listening === "recording" ? "Остановить запись" : "Сказать голосом"}
              aria-label={listening === "recording" ? "Остановить запись" : "Сказать голосом"}
              className={`flex items-center gap-1.5 rounded-full p-2 text-sm transition disabled:opacity-40 ${
                listening === "recording"
                  ? "bg-red-500/20 px-3 text-red-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              {listening === "transcribing" ? (
                <LoaderCircle className="size-5 animate-spin" />
              ) : listening === "recording" ? (
                <>
                  <span className="size-2 animate-pulse rounded-full bg-red-400" />
                  {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
                  <Square className="size-3.5 fill-current" />
                </>
              ) : (
                <Mic className="size-5" />
              )}
            </button>
          )}

          {voiceInput && onVoiceModeChange && (
            <button
              type="button"
              onClick={() => {
                primeSpeech();
                onVoiceModeChange(!voiceMode);
              }}
              aria-pressed={voiceMode}
              title="Голосовой режим: сказанное отправляется сразу, а ответ читается вслух"
              aria-label="Голосовой режим"
              className={`flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm transition sm:px-3 ${
                voiceMode
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <AudioLines className="size-4" />
              <span className="hidden sm:inline">Голосом</span>
            </button>
          )}

          {canDraw && (
            <button
              type="button"
              onClick={() => onImageModeChange(!imageMode)}
              aria-pressed={imageMode}
              title={canEditPhotos ? "Нарисовать картинку по описанию или обработать фото" : "Нарисовать картинку по описанию"}
              aria-label="Картинка"
              className={`flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm transition sm:px-3 ${
                imageMode
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Palette className="size-4" />
              <span className="hidden sm:inline">Картинка</span>
            </button>
          )}

          {canFilm && onVideoModeChange && (
            <button
              type="button"
              onClick={() => onVideoModeChange(!videoMode)}
              aria-pressed={videoMode}
              title={canAnimate ? "Снять видео по описанию или оживить фото" : "Снять видео по описанию"}
              aria-label="Видео"
              className={`flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm transition sm:px-3 ${
                videoMode
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Clapperboard className="size-4" />
              <span className="hidden sm:inline">Видео</span>
            </button>
          )}

          {model?.search && !mediaMode && (
            <button
              type="button"
              onClick={() => onWebSearchChange(!webSearch)}
              aria-pressed={webSearch}
              title="Искать свежую информацию в интернете и показывать источники"
              aria-label="Поиск в интернете"
              className={`flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm transition sm:px-3 ${
                webSearch
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Globe className="size-4" />
              <span className="hidden sm:inline">Поиск</span>
            </button>
          )}

          {model?.reasoning && !mediaMode && (
            <button
              type="button"
              onClick={() => onDeepThinkingChange(!deepThinking)}
              aria-pressed={deepThinking}
              title="Модель дольше размышляет над ответом"
              aria-label="Думать глубже"
              className={`flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm transition sm:px-3 ${
                deepThinking
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Brain className="size-4" />
              <span className="hidden sm:inline">Думать глубже</span>
            </button>
          )}

          <div className="flex-1" />

          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              title="Остановить"
              className="maryx-button rounded-xl p-2.5"
            >
              <Square className="size-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title="Отправить"
              className="maryx-button rounded-xl p-2.5 disabled:!bg-zinc-800 disabled:!text-zinc-500"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-center text-xs text-red-300">{error}</p>}
    </div>
  );
}
