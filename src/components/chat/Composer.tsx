"use client";

import {
  ArrowUp,
  AudioLines,
  Brain,
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
import type { Attachment, ModelInfo } from "@/lib/types";

interface Props {
  model: ModelInfo | undefined;
  disabled: boolean;
  streaming: boolean;
  deepThinking: boolean;
  onDeepThinkingChange: (value: boolean) => void;
  /** Search the web while answering (models with `search`). */
  webSearch: boolean;
  onWebSearchChange: (value: boolean) => void;
  /** An image model is available, so the "draw" toggle can be offered. */
  canDraw: boolean;
  /** The next message is a picture description, not a question. */
  imageMode: boolean;
  onImageModeChange: (value: boolean) => void;
  /** How dictation is recognized: on our server, by the browser, or not at all. */
  voiceInput: "server" | "browser" | null;
  /** Talk mode: dictated messages are sent right away and answers are read aloud. */
  voiceMode: boolean;
  onVoiceModeChange: ((value: boolean) => void) | null;
  onSend: (text: string, attachments: Attachment[], viaVoice?: boolean) => void;
  onStop: () => void;
}

const MAX_ATTACHMENTS = 4;

export function Composer({
  model,
  disabled,
  streaming,
  deepThinking,
  onDeepThinkingChange,
  webSearch,
  onWebSearchChange,
  canDraw,
  imageMode,
  onImageModeChange,
  voiceInput,
  voiceMode,
  onVoiceModeChange,
  onSend,
  onStop,
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

  // Documents work with any model; pictures need one that can see.
  const canAttach = !imageMode;
  const canSeeImages = model?.vision !== false;
  const canSend = !disabled && !streaming && (imageMode ? text.trim() !== "" : text.trim() !== "" || attachments.length > 0);

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
    onSend(text.trim(), imageMode ? [] : attachments);
    setText("");
    // A picture prompt doesn't take the files along; they stay for the next message.
    if (!imageMode) setAttachments([]);
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
      onSend(spoken, imageMode ? [] : attachments, true);
      if (!imageMode) setAttachments([]);
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
        {attachments.length > 0 && imageMode && (
          <p className="px-2 pt-1 text-xs text-zinc-500">В режиме «Картинка» файлы не отправляются — они останутся для следующего сообщения.</p>
        )}
        {attachments.length > 0 && (
          <div className={`flex flex-wrap gap-2 p-2 ${imageMode ? "opacity-40" : ""}`}>
            {attachments.map((a, i) => (
              <div key={i} className="relative">
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
              ? "Сначала подключите провайдера в настройках"
              : imageMode
                ? "Опишите картинку: что на ней, стиль, настроение…"
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
            accept={ATTACH_ACCEPT}
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
              imageMode
                ? "В режиме рисования вложения не нужны"
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
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
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
              title="Нарисовать картинку по описанию"
              aria-label="Картинка"
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
                imageMode
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Palette className="size-4" />
              <span className="hidden sm:inline">Картинка</span>
            </button>
          )}

          {model?.search && !imageMode && (
            <button
              type="button"
              onClick={() => onWebSearchChange(!webSearch)}
              aria-pressed={webSearch}
              title="Искать свежую информацию в интернете и показывать источники"
              aria-label="Поиск в интернете"
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
                webSearch
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Globe className="size-4" />
              <span className="hidden sm:inline">Поиск</span>
            </button>
          )}

          {model?.reasoning && !imageMode && (
            <button
              type="button"
              onClick={() => onDeepThinkingChange(!deepThinking)}
              aria-pressed={deepThinking}
              title="Модель дольше размышляет над ответом"
              aria-label="Думать глубже"
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
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
