"use client";

import { EffectSymbol,
  ArrowUp,
  AudioLines,
  Brain,
  Camera,
  Film,
  MonitorUp,
  Clapperboard,
  FileText,
  Globe,
  LoaderCircle,
  Mic,
  Palette,
  Paperclip,
  Play,
  Sparkles,
  Square,
  Telescope,
  UsersRound,
  Undo2,
  X,
} from "@/components/MaryxIcons";
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
import { canCaptureScreen, canUseCamera, captureScreen, clock, videoSheet } from "@/lib/client/capture";
import { enhancePrompt } from "@/lib/client/media";
import { discardVideo, uploadVideo, videoMime } from "@/lib/client/upload";
import { CAMERA_MOTIONS, IMAGE_STYLES, PHOTO_EFFECTS } from "@/lib/effects";
import type { Attachment, ModelInfo } from "@/lib/types";
import { CameraDialog } from "./CameraDialog";

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
  /** Deep research (MARYX): several searches, then a report with sources. */
  research?: boolean;
  onResearchChange?: (value: boolean) => void;
  /** Консилиум (MARYX): several strong models answer, MARYX combines the best. */
  council?: boolean;
  onCouncilChange?: (value: boolean) => void;
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
  /** Draw mode: a new picture's look (an id of IMAGE_STYLES), or null. */
  style?: string | null;
  onStyleChange?: (value: string | null) => void;
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
/** The biggest video (the server takes the same). */
const MAX_VIDEO_MB = 100;

/** A video file (phones don't always say its type; the name does). */
function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|avi|3gp)$/i.test(file.name);
}

/** One line of the attach menu. */
function MenuItem({
  icon: Icon,
  label,
  hint,
  onClick,
  close,
}: {
  icon: typeof Paperclip;
  label: string;
  hint: string;
  onClick: () => void;
  close: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        close();
        onClick();
      }}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/5"
    >
      <Icon className="size-4 shrink-0 text-violet-300" />
      <span className="min-w-0">
        <span className="block text-sm text-zinc-100">{label}</span>
        <span className="block text-xs text-zinc-500">{hint}</span>
      </span>
    </button>
  );
}

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
  research = false,
  onResearchChange,
  council = false,
  onCouncilChange,
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
  style = null,
  onStyleChange,
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
  /** Videos still uploading, by their local copy: taking one out stops it. */
  const uploads = useRef(new Map<string, AbortController>());
  const recognizer = useRef<{ stop: () => void } | null>(null);
  // Set before the microphone permission prompt, so a second tap can't open another recorder.
  const starting = useRef(false);
  const alive = useRef(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // The attach menu, the camera, and work being done on this device (a screenshot, a video's frames).
  const [menu, setMenu] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [busy, setBusy] = useState<"screen" | "video" | null>(null);

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
  const uploading = attachments.some((a) => a.progress !== undefined);
  const canSend = !disabled && !streaming && !uploading && (text.trim() !== "" || sending.length > 0);
  // "✨ Улучшить" (draw and video modes): the rewrite in progress, and the words before it.
  const [enhancing, setEnhancing] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const enhance = async () => {
    const idea = text.trim();
    if (!idea || enhancing) return;
    setError(null);
    setEnhancing(true);
    try {
      const better = await enhancePrompt(videoMode ? "video" : "image", idea, sending.length > 0);
      setBefore(idea);
      setText(better);
      if (textarea.current) {
        textarea.current.style.height = "auto";
        textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 240)}px`;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setEnhancing(false);
  };

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
        } else if (isVideoFile(file)) {
          // A whole video: uploaded and played in the chat (MARYX reads its frames).
          void addVideo(file);
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

  /** A picture made on this device (camera, screen), as an attachment. */
  const addPicture = async (blob: Blob, name: string) => {
    try {
      const image = await imageToAttachment(blob);
      const total = attachments.reduce((sum, a) => sum + (a.data?.length ?? 0), 0);
      if (total + (image.data?.length ?? 0) > MAX_TOTAL_BASE64) {
        setError("Вложения слишком большие: всего до 3 МБ за сообщение.");
        return;
      }
      const picture: Attachment = { mime: image.mime, data: image.data, name };
      setAttachments((list) => [...list, picture].slice(0, MAX_ATTACHMENTS));
      textarea.current?.focus();
    } catch {
      setError("Не удалось сохранить снимок.");
    }
  };

  const shareScreen = async () => {
    setError(null);
    setBusy("screen");
    try {
      await addPicture(await captureScreen(), "Снимок экрана");
    } catch (e) {
      // Cancelled in the browser's dialog: nothing to say.
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) setError("Не удалось сделать снимок экрана.");
    }
    setBusy(null);
  };

  /** The attachment in the list with this local copy (a video and its frames share it). */
  const patchVideo = (preview: string, change: Partial<Attachment>) =>
    setAttachments((list) => list.map((a) => (a.preview === preview && !a.hidden ? { ...a, ...change } : a)));

  /**
   * A video goes whole, like in a messenger: it uploads (in parts, with
   * progress) and plays in the chat. MARYX reads its frames, taken right here
   * and sent along unseen.
   */
  const addVideo = async (file: File) => {
    setError(null);
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      setError(`Видео слишком большое: до ${MAX_VIDEO_MB} МБ.`);
      return;
    }
    const preview = URL.createObjectURL(file);
    setAttachments((list) => [...list, { mime: videoMime(file), name: file.name, preview, progress: 0 }].slice(0, MAX_ATTACHMENTS));
    textarea.current?.focus();
    const frames = videoSheet(file).then(
      async ({ sheet, duration }) => {
        const image = await imageToAttachment(sheet);
        const total = attachments.reduce((sum, a) => sum + (a.data?.length ?? 0), 0);
        if (total + (image.data?.length ?? 0) > MAX_TOTAL_BASE64) return;
        const hidden: Attachment = { mime: image.mime, data: image.data, name: `Видео «${file.name}», ${clock(duration)}`, hidden: true, preview };
        setAttachments((list) => (list.some((a) => a.preview === preview) ? [...list, hidden] : list));
      },
      // The browser can't read this video (a codec it lacks): it still goes, MARYX just can't see it.
      () => {},
    );
    const controller = new AbortController();
    uploads.current.set(preview, controller);
    try {
      const { key, url, mime } = await uploadVideo(file, (progress) => patchVideo(preview, { progress }), controller.signal);
      await frames;
      // Taken out while it was being finished: it isn't kept.
      if (controller.signal.aborted) discardVideo(key);
      else patchVideo(preview, { key, url, mime, progress: undefined });
    } catch (e) {
      if (controller.signal.aborted) return;
      setAttachments((list) => list.filter((a) => a.preview !== preview));
      URL.revokeObjectURL(preview);
      setError(e instanceof Error ? e.message : "Не удалось загрузить видео.");
    } finally {
      uploads.current.delete(preview);
    }
  };

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), sending);
    setText("");
    setBefore(null);
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
    <div className="workspace-composer mx-auto w-full max-w-3xl">
      <div className="composer-panel relative rounded-3xl border p-3 transition-colors">
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
        {uploading && <p className="px-2 pt-1 text-xs text-zinc-500">Видео загружается — отправить можно, когда загрузка закончится.</p>}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2">
            {attachments.map((a, i) => a.hidden ? null : (
              <div key={i} className={`attachment-preview relative ${sending.includes(a) ? "" : "opacity-40"}`}>
                {a.mime.startsWith("video/") ? (
                  <div className="video-attachment" title={a.name} data-uploading={a.progress !== undefined || undefined}>
                    <div className="video-attachment-poster">
                      <video src={a.preview ?? a.url} muted playsInline preload="metadata" aria-label={`Видео «${a.name ?? ""}»`} className="size-full object-cover" />
                      <span>{a.progress !== undefined ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}</span>
                    </div>
                    <div className="video-attachment-info">
                      <strong>{a.name || "Видео"}</strong>
                      <span>{a.progress !== undefined ? `Загрузка · ${a.progress}%` : "Готово к отправке"}</span>
                      {a.progress !== undefined && <progress max={100} value={a.progress} aria-label={`Загрузка видео «${a.name ?? ""}»`} />}
                    </div>
                  </div>
                ) : isDocumentAttachment(a) ? (
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
                  aria-label="Убрать вложение"
                  onClick={() => {
                    // A video goes with its frames; its upload stops, or the uploaded file goes.
                    setAttachments((list) => list.filter((x, j) => j !== i && !(a.preview && x.preview === a.preview)));
                    if (a.preview) uploads.current.get(a.preview)?.abort();
                    if (a.key) discardVideo(a.key);
                    if (a.preview) URL.revokeObjectURL(a.preview);
                  }}
                  className="attachment-remove absolute -right-1.5 -top-1.5 rounded-full bg-zinc-700 p-0.5 text-zinc-200 hover:bg-zinc-600"
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
                <EffectSymbol emoji={e.emoji} /> {e.label}
              </button>
            ))}
          </div>
        )}

        {imageMode && onStyleChange && !sending.length && (
          // One scrolling line on phones, like the camera moves.
          <div role="group" aria-label="Стиль" className="flex items-center gap-1.5 overflow-x-auto px-2 pb-1 sm:flex-wrap">
            <span className="mr-0.5 shrink-0 text-xs text-zinc-500">Стиль:</span>
            {IMAGE_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={style === s.id}
                onClick={() => onStyleChange(style === s.id ? null : s.id)}
                className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-0.5 text-xs transition ${
                  style === s.id
                    ? "border-violet-300/50 bg-violet-500/20 text-violet-100"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-violet-300/40 hover:text-zinc-100"
                }`}
              >
                <EffectSymbol emoji={s.emoji} /> {s.label}
              </button>
            ))}
          </div>
        )}

        {videoMode && onCameraChange && (
          // One scrolling line on phones, so the text field keeps its room.
          <div role="group" aria-label="Движение камеры" className="flex items-center gap-1.5 overflow-x-auto px-2 pb-1 sm:flex-wrap">
            <span className="mr-0.5 shrink-0 text-xs text-zinc-500">Камера:</span>
            {CAMERA_MOTIONS.filter((m) => m.featured).map((m) => (
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
                <EffectSymbol emoji={m.emoji} /> {m.label}
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
            setBefore(null);
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
                : research && !mediaMode
                ? "О чём исследование? Например: какой электромобиль выбрать в 2026 году"
                : council && !mediaMode
                ? "Вопрос для консилиума: три ИИ ответят, MARYX соберёт лучшее из их ответов"
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

        <div className="composer-actions flex flex-wrap items-center gap-1 px-1">
          <input
            ref={fileInput}
            type="file"
            accept={takesPhotos ? "image/*" : `${ATTACH_ACCEPT},video/*`}
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
                  ? "Прикрепить файл: PDF, Word, Excel, CSV, TXT, изображение или видео"
                  : "Прикрепить документ: PDF, Word, Excel, CSV, TXT"
            }
            disabled={!canAttach || disabled || attachments.length >= MAX_ATTACHMENTS || busy !== null}
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
            aria-label="Прикрепить"
            className="rounded-full p-2 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100 disabled:opacity-40"
          >
            {busy ? <LoaderCircle className="size-5 animate-spin" /> : <Paperclip className="size-5" />}
          </button>
          <input
            ref={videoInput}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void addVideo(file);
            }}
          />
          {menu && (
            <>
              {/* A click anywhere else closes the menu. */}
              <button type="button" aria-hidden="true" tabIndex={-1} onClick={() => setMenu(false)} className="fixed inset-0 z-10 cursor-default" />
              <div role="menu" aria-label="Прикрепить" className="absolute bottom-14 left-2 z-20 w-64 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-2xl">
                <MenuItem
                  icon={Paperclip}
                  label={takesPhotos ? "Фото" : "Файл или фото"}
                  hint={takesPhotos ? "С устройства" : "PDF, Word, Excel, картинки"}
                  onClick={() => fileInput.current?.click()}
                  close={() => setMenu(false)}
                />
                {canSeeImages && canUseCamera() && (
                  <MenuItem icon={Camera} label="Снять камерой" hint="Фото прямо в чат" onClick={() => setShooting(true)} close={() => setMenu(false)} />
                )}
                {canSeeImages && canCaptureScreen() && (
                  <MenuItem
                    icon={MonitorUp}
                    label="Показать экран"
                    hint="MARYX увидит экран или окно"
                    onClick={() => void shareScreen()}
                    close={() => setMenu(false)}
                  />
                )}
                {canSeeImages && !mediaMode && (
                  <MenuItem
                    icon={Film}
                    label="Видео"
                    hint="Целиком: смотрите в чате, MARYX разберёт"
                    onClick={() => videoInput.current?.click()}
                    close={() => setMenu(false)}
                  />
                )}
              </div>
            </>
          )}
          {shooting && (
            <CameraDialog
              onClose={() => setShooting(false)}
              onShot={(photo) => {
                setShooting(false);
                void addPicture(photo, "Фото с камеры");
              }}
            />
          )}

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

          {model?.search && !mediaMode && onResearchChange && (
            <button
              type="button"
              onClick={() => onResearchChange(!research)}
              aria-pressed={research}
              title="Глубокое исследование: MARYX ищет по нескольким направлениям и пишет отчёт со ссылками"
              aria-label="Исследование"
              className={`flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm transition sm:px-3 ${
                research ? "bg-violet-500/20 text-violet-200" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Telescope className="size-4" />
              <span className="hidden sm:inline">Исследование</span>
            </button>
          )}

          {!mediaMode && onCouncilChange && (
            <button
              type="button"
              onClick={() => onCouncilChange(!council)}
              aria-pressed={council}
              title="Консилиум: на вопрос сразу отвечают три сильных ИИ, MARYX сверяет их и пишет лучший ответ"
              aria-label="Консилиум"
              className={`flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm transition sm:px-3 ${
                council ? "bg-violet-500/20 text-violet-200" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <UsersRound className="size-4" />
              <span className="hidden sm:inline">Консилиум</span>
            </button>
          )}

          {model?.search && !mediaMode && !research && (
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

          {mediaMode && before !== null && !enhancing && (
            <button
              type="button"
              onClick={() => {
                setText(before);
                setBefore(null);
              }}
              title="Вернуть как было"
              aria-label="Вернуть как было"
              className="rounded-full p-2 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-100"
            >
              <Undo2 className="size-4" />
            </button>
          )}
          {mediaMode && (
            <button
              type="button"
              onClick={() => void enhance()}
              disabled={!text.trim() || enhancing || disabled}
              title="Улучшить описание: MARYX сделает его подробным и профессиональным"
              aria-label="Улучшить описание"
              className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm text-violet-200 transition hover:bg-violet-500/15 disabled:opacity-40 sm:px-3"
            >
              {enhancing ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              <span className="hidden sm:inline">{enhancing ? "Улучшаю…" : "Улучшить"}</span>
            </button>
          )}

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
