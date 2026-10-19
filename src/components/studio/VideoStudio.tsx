"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowRight,
  Camera,
  ScriptVideo,
  PhotoMotion,
  FrameTransition,
  VideoMagic,
  Recast,
  Check,
  Clapperboard,
  ImagePlus,
  KeyRound,
  Layers3 as Layers,
  LoaderCircle,
  Sparkles,
  Type,
  Undo2,
  WandSparkles,
  X,
} from "@/components/MaryxIcons";
import { CAMERA_MOTIONS, VIDEO_EFFECTS } from "@/lib/effects";
import { sendToImageStudio, type Frame } from "@/lib/client/frames";
import { enhancePrompt, generate, removeMedia, useMediaItems } from "@/lib/client/media";
import { useModels } from "@/lib/client/useModels";
import { useStoredJson } from "@/lib/client/useStored";
import { imageToAttachment, MAX_TOTAL_BASE64, nearestRatio } from "@/lib/client/util";
import type { AspectRatio, MediaFile, MediaItem } from "@/lib/types";
import { useApp, type ModelChoice } from "../AppState";
import { StudioImage } from "../WorkspaceVisuals";
import { StudioDialog } from "./StudioDialog";
import { findModel, MaryxBadge, ModelPicker } from "../ModelPicker";
import { PresetArt } from "./PresetArt";
import { TrendStudio } from "./TrendStudio";
import { PromptGallery } from "./PromptGallery";
import { VideoGallery } from "./VideoGallery";

type Mode = "text" | "photo" | "frames" | "effects" | "trend";

const MODES: { id: Mode; label: string; Icon: typeof Type; hint: string }[] = [
  { id: "text", label: "Текст в видео", Icon: ScriptVideo, hint: "Опишите сцену — MARYX снимет её" },
  { id: "photo", label: "Оживить фото", Icon: PhotoMotion, hint: "Ваше фото станет первым кадром" },
  { id: "frames", label: "Начало и конец", Icon: FrameTransition, hint: "Плавный переход от первого кадра ко второму" },
  { id: "effects", label: "Эффекты", Icon: VideoMagic, hint: "Взрыв, левитация, портал — в один клик" },
  { id: "trend", label: "Тренд", Icon: Recast, hint: "Повторите трендовое видео со своим персонажем" },
];

const RATIOS: AspectRatio[] = ["16:9", "9:16"];
const DURATIONS = [5, 10];
const COUNTS = [1, 2];

const IDEAS: Record<Mode, string[]> = {
  text: [
    "Дрон медленно пролетает над заснеженными горами на рассвете",
    "Кот в очках печатает на ноутбуке в стиле офисной комедии",
    "Неоновый город будущего ночью, по улицам едут летающие машины",
    "Волны разбиваются о скалы, замедленная съёмка, звук прибоя",
  ],
  photo: ["Улыбается и смотрит в камеру", "Лёгкий ветер, волосы и одежда развеваются", "Поворачивает голову и подмигивает", "Вокруг появляются волшебные искры"],
  frames: ["Плавное превращение одного в другое", "Камера пролетает от первого кадра ко второму", "День сменяется ночью", "Время ускоряется, всё меняется вокруг"],
  effects: [],
  trend: [],
};

const PLACEHOLDER: Record<Mode, string> = {
  text: "Опишите сцену: что происходит, где, какое настроение и звук…",
  photo: "Что происходит на фото? Например: улыбается и машет рукой, ветер в волосах. Можно оставить пустым",
  frames: "Что происходит между кадрами? Например: день сменяется ночью. Можно оставить пустым",
  effects: "Кто или что в кадре? Например: девушка в красном платье на крыше. С фото можно оставить пустым",
  trend: "",
};

const BUTTON: Record<Mode, string> = { text: "Создать видео", photo: "Оживить", frames: "Создать переход", effects: "Применить эффект", trend: "" };

/** The image studio hands a picture here ("Оживить" on a card): it becomes the first frame. */
const ANIMATE_KEY = "maryx:animate";

/** Loads a stored picture (an earlier first frame, a picture to animate) as a frame. */
async function frameFrom(file: MediaFile): Promise<Frame> {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error("Не удалось загрузить изображение");
  return imageToAttachment(await res.blob());
}

const src = (f: Frame) => `data:${f.mime};base64,${f.data}`;

/** One frame slot: a drop zone, or the photo with "replace" and "remove". */
function FrameSlot({
  frame,
  label,
  alt,
  busy,
  onPick,
  onDrop,
  onClear,
  compact = false,
}: {
  frame: Frame | undefined;
  label: string;
  alt: string;
  busy: boolean;
  onPick: () => void;
  onDrop: (files: File[]) => void;
  onClear: () => void;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) onDrop([...e.dataTransfer.files]);
  };
  return (
    <div
      className={`vs-slot ${compact ? "vs-slot--compact" : ""}`}
      data-over={over || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      {frame ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
          <img src={src(frame)} alt={alt} />
          <span className="vs-slot-tag">{label}</span>
          <div className="vs-slot-actions">
            <button type="button" onClick={onPick} aria-label={`Заменить: ${label.toLowerCase()}`} title="Заменить">
              <ImagePlus size={15} />
            </button>
            <button type="button" onClick={onClear} aria-label={`Убрать: ${label.toLowerCase()}`} title="Убрать">
              <X size={15} />
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="vs-slot-empty" onClick={onPick} disabled={busy} aria-label={`Загрузить ${label.toLowerCase()}`}>
          <span className="vs-upload-symbol">{busy ? <LoaderCircle className="size-6 animate-spin" /> : <ImagePlus size={compact ? 20 : 26} />}</span>
          <span>{label}</span>
          {!compact && <small>Перетащите фото сюда или нажмите</small>}
        </button>
      )}
    </div>
  );
}

/** A preset card: its little animated scene and its name. */
function PresetCard({
  kind,
  id,
  label,
  hint,
  selected,
  onClick,
}: {
  kind: "camera" | "effect";
  id: string;
  label: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="preset-card" aria-pressed={selected} onClick={onClick} title={hint}>
      <PresetArt motion={kind === "camera" ? id : undefined} effect={kind === "effect" ? id : undefined} live={selected} />
      <span className="preset-card-symbol" aria-hidden="true">{kind === "camera" ? <Camera size={14} /> : <VideoMagic size={14} />}</span>
      <span className="preset-card-label">
        {label}
        {selected && <Check size={13} />}
      </span>
    </button>
  );
}

/** Every camera move and effect, Higgsfield style: pick one of each and they mix. */
function PresetDialog({
  tab,
  camera,
  effect,
  onTab,
  onCamera,
  onEffect,
  onClose,
}: {
  tab: "camera" | "effect";
  camera: string | null;
  effect: string | null;
  onTab: (tab: "camera" | "effect") => void;
  onCamera: (id: string | null) => void;
  onEffect: (id: string | null) => void;
  onClose: () => void;
}) {
  const list = tab === "camera" ? CAMERA_MOTIONS : VIDEO_EFFECTS;
  const chosen = tab === "camera" ? camera : effect;
  return (
    <StudioDialog title="Движения камеры и эффекты" className="vs-dialog" onClose={onClose}>
        <div className="vs-dialog-head">
          <div role="tablist" aria-label="Что выбрать" className="vs-tabs">
            <button type="button" role="tab" aria-selected={tab === "camera"} onClick={() => onTab("camera")}>
              Движение камеры <span>{CAMERA_MOTIONS.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === "effect"} onClick={() => onTab("effect")}>
              Эффекты <span>{VIDEO_EFFECTS.length}</span>
            </button>
          </div>
          <button type="button" onClick={onClose} className="vs-icon-button" aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        <p className="vs-dialog-note">
          {tab === "camera"
            ? "Как движется камера. Можно добавить и эффект — они смешаются в одном видео."
            : "Что происходит в кадре. Лучше всего работает с вашим фото."}
        </p>
        <div className="vs-preset-grid">
          <button type="button" className="preset-card preset-card--none" aria-pressed={chosen === null} onClick={() => (tab === "camera" ? onCamera(null) : onEffect(null))}>
            <span className="preset-none-art">
              <X size={22} />
            </span>
            <span className="preset-card-label">{tab === "camera" ? "Без движения" : "Без эффекта"}</span>
          </button>
          {list.map((p) => (
            <PresetCard
              key={p.id}
              kind={tab}
              id={p.id}
              label={p.label}
              hint={p.hint}
              selected={chosen === p.id}
              onClick={() => (tab === "camera" ? onCamera(p.id) : onEffect(p.id))}
            />
          ))}
        </div>
    </StudioDialog>
  );
}

/**
 * «Видео»: a film studio in the Higgsfield spirit. Text, a photo or two frames
 * become a clip; camera moves and effects mix in one click; finished clips
 * play on hover, open full size, continue from their last frame, or give a
 * still to the image studio.
 */
export function VideoStudio() {
  const { me, maryxOnly } = useApp();
  const router = useRouter();
  const { data, loading } = useModels("video");
  const models = useMemo(() => data?.models ?? [], [data]);
  const items = useMediaItems("video");
  const [saved, setSaved] = useStoredJson<ModelChoice>("maryx:video-model");

  const [mode, setMode] = useState<Mode>("text");
  const [start, setStart] = useState<Frame | undefined>();
  const [end, setEnd] = useState<Frame | undefined>();
  const [prompt, setPrompt] = useState("");
  const [before, setBefore] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [camera, setCamera] = useState<string | null>(null);
  const [effect, setEffect] = useState<string | null>(null);
  const [ratio, setRatio] = useState<AspectRatio>("16:9");
  const [duration, setDuration] = useState(5);
  const [count, setCount] = useState(1);
  const [reading, setReading] = useState<"start" | "end" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<"camera" | "effect" | null>(null);
  /** «Продолжить»: the first frame is the last one of this clip. */
  const [continuing, setContinuing] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const slot = useRef<"start" | "end">("start");
  const panel = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const photoOk = models.some((m) => m.photoEdit);
  const lastFrameOk = models.some((m) => m.photoEdit && m.lastFrame);
  const noProviders = data !== null && models.length === 0;
  const fallback = models.find((m) => m.featured) ?? models[0];
  const choice: ModelChoice | null = maryxOnly
    ? fallback
      ? { provider: fallback.provider, model: fallback.id }
      : null
    : findModel(models, saved) || !fallback
      ? saved
      : { provider: fallback.provider, model: fallback.id };
  const target = choice;
  const targetModel = target ? findModel(models, target) : undefined;

  // What goes: the frames this mode uses.
  const frames = mode === "text" ? [] : mode === "frames" ? [start, end].filter((f): f is Frame => Boolean(f)) : start ? [start] : [];
  const withPhoto = frames.length > 0;
  const ready =
    Boolean(me && target && !reading) &&
    (mode === "text"
      ? prompt.trim().length > 0
      : mode === "photo"
        ? Boolean(start)
        : mode === "frames"
          ? Boolean(start && end)
          : Boolean(effect && (start || prompt.trim())));
  const modelCant = withPhoto && targetModel && !maryxOnly && !targetModel.photoEdit;
  const usage = me?.usage.video;
  const left = usage && usage.limit !== null ? Math.max(0, usage.limit - usage.used) : null;

  const readFrame = async (file: File, which: "start" | "end") => {
    setError(null);
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
      setError("Можно загрузить только фото (JPEG, PNG, WebP, HEIC).");
      return;
    }
    setReading(which);
    try {
      const frame = await imageToAttachment(file);
      const other = which === "start" ? end : start;
      if ((frame.data?.length ?? 0) + (mode === "frames" ? (other?.data?.length ?? 0) : 0) > MAX_TOTAL_BASE64) {
        setError("Фото слишком большие: всего до 3 МБ за раз.");
      } else if (which === "start") {
        setStart(frame);
        setContinuing(null);
      } else setEnd(frame);
    } catch {
      setError(`Не удалось прочитать «${file.name}» — сохраните его как JPEG или PNG.`);
    }
    setReading(null);
  };

  const pick = (which: "start" | "end") => {
    slot.current = which;
    fileInput.current?.click();
  };

  // A picture sent here from the image studio ("Оживить") becomes the first frame.
  useEffect(() => {
    let handed: MediaFile | null = null;
    try {
      handed = JSON.parse(sessionStorage.getItem(ANIMATE_KEY) ?? "null") as MediaFile | null;
    } catch {
      // Storage blocked: nothing was handed over.
    }
    if (!handed?.url) return;
    let alive = true;
    frameFrom(handed).then(
      (frame) => {
        if (!alive) return;
        setMode("photo");
        setStart(frame);
        try {
          sessionStorage.removeItem(ANIMATE_KEY);
        } catch {
          // already unreadable
        }
      },
      () => alive && setError("Не удалось загрузить картинку — попробуйте ещё раз."),
    );
    return () => {
      alive = false;
    };
  }, []);

  const toPanel = () => {
    panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    promptRef.current?.focus({ preventScroll: true });
  };

  const submit = () => {
    if (!ready || !target) return;
    const request = {
      kind: "video" as const,
      ...target,
      prompt: prompt.trim(),
      aspectRatio: withPhoto ? nearestRatio(frames[0].width, frames[0].height, RATIOS) : ratio,
      ...(withPhoto ? { images: frames.map((f) => ({ mime: f.mime, data: f.data! })) } : {}),
      ...(camera ? { camera } : {}),
      ...(effect && mode !== "frames" ? { effect } : {}),
      duration,
    };
    for (let i = 0; i < count; i++) void generate(request);
  };

  const enhance = async () => {
    const idea = prompt.trim();
    if (!idea || enhancing) return;
    setError(null);
    setEnhancing(true);
    try {
      const better = await enhancePrompt("video", idea, withPhoto);
      setBefore(idea);
      setPrompt(better);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setEnhancing(false);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  /** "Повторить": the clip's words, frames and settings back in the panel. */
  const reuse = (item: MediaItem) => {
    const auto = /^(Оживить фото|Переход между кадрами|Эффект «)/.test(item.prompt);
    setPrompt(auto ? "" : item.prompt);
    setBefore(null);
    setCamera(item.camera ?? null);
    setEffect(item.effect ?? null);
    setDuration(item.duration && DURATIONS.includes(item.duration) ? item.duration : 5);
    if (RATIOS.includes(item.aspectRatio)) setRatio(item.aspectRatio);
    setContinuing(null);
    const inputs = item.inputs ?? [];
    setMode(item.effect ? "effects" : inputs.length > 1 ? "frames" : inputs.length ? "photo" : "text");
    setStart(undefined);
    setEnd(undefined);
    if (inputs.length) {
      setReading("start");
      Promise.all(inputs.slice(0, 2).map(frameFrom)).then(
        ([first, second]) => {
          setStart(first);
          setEnd(second);
          setReading(null);
        },
        () => {
          setError("Не удалось загрузить кадры — загрузите фото заново.");
          setReading(null);
        },
      );
    }
    toPanel();
  };

  /** «Продолжить»: the clip's last frame starts the next one. */
  const continueFrom = (frame: Frame, item: MediaItem) => {
    setMode("photo");
    setStart(frame);
    setEnd(undefined);
    setPrompt("");
    setBefore(null);
    setEffect(null);
    setContinuing(item.prompt);
    setError(null);
    toPanel();
  };

  /** A still from a clip: a new video from it, or a picture to edit in the image studio. */
  const takeFrame = (frame: Frame, to: "video" | "image") => {
    if (to === "image") {
      if (sendToImageStudio(frame)) router.push("/images");
      else setError("Браузер не дал передать кадр — скачайте его и загрузите в студии картинок.");
      return;
    }
    setMode("photo");
    setStart(frame);
    setContinuing(null);
    toPanel();
  };

  // The kinds of video, at the top of the panel (the trend has its own panel).
  const tabs = (
    <div role="tablist" aria-label="Что снимаем" className="vs-modes" onKeyDown={(e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.click();
      buttons[next]?.focus();
    }}>
      {MODES.map(({ id, label, Icon, hint }, index) => {
        const off = (id === "photo" && !photoOk) || (id === "frames" && !lastFrameOk);
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            aria-label={label}
            id={`video-mode-${id}`}
            aria-controls="video-workspace"
            tabIndex={mode === id ? 0 : -1}
            disabled={off}
            title={off ? "Подключённые модели этого пока не умеют" : hint}
            onClick={() => switchMode(id)}
          >
            <span className="vs-mode-symbol"><Icon size={23} /></span>
            <span className="vs-mode-copy"><strong>{label}</strong><small>{hint}</small></span>
            <span className="vs-mode-number" aria-hidden="true">0{index + 1}</span>
          </button>
        );
      })}
    </div>
  );

  const chosenCamera = CAMERA_MOTIONS.find((m) => m.id === camera);
  const chosenEffect = VIDEO_EFFECTS.find((e) => e.id === effect);
  const featured = CAMERA_MOTIONS.filter((m) => m.featured);

  return (
    <div className="studio-page h-full overflow-y-auto">
      <div className="page-content video-studio-page">
        <header className="film-hero">
          <StudioImage preload />
          <div className="film-hero-shade" />
          <div className="film-hero-copy"><span className="film-kicker"><Clapperboard size={15} />Киностудия MARYX</span><h1>Ваши идеи.<br /><span>В движении.</span></h1><p>От первой мысли до последнего кадра.<br />Снимайте истории, которые хочется пересматривать.</p></div>
          <div className="film-hero-footer"><span><span className="film-live-dot" />Текст. Кадры. Камера. Ваш стиль.</span>{left !== null && <span className="film-quota"><Clapperboard size={14} />Сегодня осталось: {left}</span>}</div>
        </header>
        {!noProviders && tabs}
        <div id="video-workspace" role={!noProviders ? "tabpanel" : undefined} aria-labelledby={!noProviders ? `video-mode-${mode}` : undefined}>
        {!noProviders && <div className="vs-workspace-heading"><div><span className="section-kicker">Ваш режиссёрский пульт</span><h2>{MODES.find(m => m.id === mode)?.label}</h2></div><p>{MODES.find(m => m.id === mode)?.hint}</p></div>}

        {noProviders ? (
          <div className="empty-notice mt-6 rounded-2xl border p-5 text-sm text-zinc-200">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <KeyRound className="size-4" /> Видео пока не подключено
            </div>
            {me?.admin ? (
              <p className="text-zinc-400">
                Добавьте OPENROUTER_API_KEY в переменные окружения сервера.{" "}
                <Link href="/settings" className="font-medium text-violet-200 underline">
                  Настройки →
                </Link>
              </p>
            ) : (
              <p className="text-zinc-400">Эта функция скоро появится.</p>
            )}
          </div>
        ) : mode === "trend" ? (
          <TrendStudio />
        ) : (
          <div className="video-studio">
            <div ref={panel} className="vs-panel composer-panel" aria-label="Создать видео">
              {mode !== "text" && (mode !== "effects" || photoOk) && (
                <div className={mode === "frames" ? "vs-frames" : ""}>
                  <FrameSlot
                    frame={start}
                    label={mode === "frames" ? "Начало" : "Начальный кадр"}
                    alt="Фото для видео"
                    busy={reading === "start"}
                    onPick={() => pick("start")}
                    onDrop={(files) => void readFrame(files[0], "start")}
                    onClear={() => {
                      setStart(undefined);
                      setContinuing(null);
                    }}
                    compact={mode === "frames"}
                  />
                  {mode === "frames" && (
                    <>
                      <span className="vs-frames-arrow" aria-hidden="true">
                        <ArrowRight size={18} />
                      </span>
                      <FrameSlot
                        frame={end}
                        label="Конец"
                        alt="Последний кадр"
                        busy={reading === "end"}
                        onPick={() => pick("end")}
                        onDrop={(files) => void readFrame(files[0], "end")}
                        onClear={() => setEnd(undefined)}
                        compact
                      />
                    </>
                  )}
                </div>
              )}
              {continuing && start && mode === "photo" && (
                <p className="vs-note">
                  <Layers size={14} /> Продолжение видео «{continuing.slice(0, 60)}»: его последний кадр стал первым. Опишите, что дальше.
                </p>
              )}
              {mode === "frames" && start && end && <div className="vs-note">Переход между кадрами</div>}

              {mode === "effects" && (
                <div className="vs-section">
                  <div className="vs-section-head">
                    <span>Эффект</span>
                    <button type="button" onClick={() => setPresets("effect")}>
                      Все эффекты
                    </button>
                  </div>
                  <div role="group" aria-label="Эффекты" className="vs-effects">
                    {VIDEO_EFFECTS.slice(0, 9).map((e) => (
                      <PresetCard key={e.id} kind="effect" id={e.id} label={e.label} hint={e.hint} selected={effect === e.id} onClick={() => setEffect(effect === e.id ? null : e.id)} />
                    ))}
                  </div>
                </div>
              )}

              <div className="vs-prompt">
                <label className="vs-field-label" htmlFor="video-description"><ScriptVideo size={15} />Сценарий</label>
                <textarea
                  id="video-description"
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setBefore(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                  }}
                  rows={mode === "text" ? 4 : 3}
                  maxLength={4000}
                  placeholder={continuing ? "Что происходит дальше? Например: герой оборачивается и идёт к морю" : PLACEHOLDER[mode]}
                  aria-label="Описание видео"
                />
                <div className="vs-prompt-tools">
                  <button type="button" onClick={() => void enhance()} disabled={!prompt.trim() || enhancing} title="MARYX превратит идею в подробное режиссёрское описание">
                    {enhancing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles size={14} />}
                    {enhancing ? "Улучшаю…" : "Улучшить промпт"}
                  </button>
                  {before !== null && !enhancing && (
                    <button
                      type="button"
                      onClick={() => {
                        setPrompt(before);
                        setBefore(null);
                      }}
                    >
                      <Undo2 size={14} /> Вернуть как было
                    </button>
                  )}
                </div>
              </div>
              {!prompt && IDEAS[mode].length > 0 && !continuing && (
                <div className="vs-ideas">
                  {IDEAS[mode].map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() => {
                        setPrompt(idea);
                        promptRef.current?.focus();
                      }}
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              )}

              <div className="vs-section">
                <div className="vs-section-head">
                  <span>Движение камеры</span>
                  <button type="button" onClick={() => setPresets("camera")}>
                    Все движения · {CAMERA_MOTIONS.length}
                  </button>
                </div>
                <div role="group" aria-label="Движение камеры" className="vs-strip">
                  {(chosenCamera && !chosenCamera.featured ? [chosenCamera, ...featured] : featured).map((m) => (
                    <PresetCard key={m.id} kind="camera" id={m.id} label={m.label} hint={m.hint} selected={camera === m.id} onClick={() => setCamera(camera === m.id ? null : m.id)} />
                  ))}
                </div>
              </div>

              {(chosenCamera || (chosenEffect && mode !== "frames")) && (
                <div className="vs-mix" aria-label="Выбрано">
                  {chosenCamera && (
                    <span>
                      Камера: {chosenCamera.label}
                      <button type="button" onClick={() => setCamera(null)} aria-label="Убрать движение камеры">
                        <X size={12} />
                      </button>
                    </span>
                  )}
                  {chosenEffect && mode !== "frames" && (
                    <span>
                      Эффект: {chosenEffect.label}
                      <button type="button" onClick={() => setEffect(null)} aria-label="Убрать эффект">
                        <X size={12} />
                      </button>
                    </span>
                  )}
                  {mode !== "effects" && mode !== "frames" && !chosenEffect && (
                    <button type="button" className="vs-mix-add" onClick={() => setPresets("effect")}>
                      + эффект
                    </button>
                  )}
                </div>
              )}

              <div className="vs-settings">
                {withPhoto ? (
                  <span className="vs-setting-note">Формат как у фото</span>
                ) : (
                  <div className="vs-setting-group"><span>Формат</span><div role="radiogroup" aria-label="Формат" className="vs-segment">
                    {RATIOS.map((r) => (
                      <button key={r} type="button" role="radio" aria-checked={ratio === r} onClick={() => setRatio(r)}>
                        <span className={`vs-ratio vs-ratio-${r.replace(":", "x")}`} aria-hidden="true" />
                        {r}
                      </button>
                    ))}
                  </div></div>
                )}
                <div className="vs-setting-group"><span>Длительность</span><div role="radiogroup" aria-label="Длительность" className="vs-segment">
                  {DURATIONS.map((d) => (
                    <button key={d} type="button" role="radio" aria-checked={duration === d} onClick={() => setDuration(d)}>
                      {d} с
                    </button>
                  ))}
                </div></div>
                <div className="vs-setting-group"><span>Варианты</span><div role="radiogroup" aria-label="Сколько вариантов" className="vs-segment" title="Каждый вариант — отдельное видео из лимита">
                  {COUNTS.map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={count === n} onClick={() => setCount(n)}>
                      ×{n}
                    </button>
                  ))}
                </div></div>
              </div>

              {modelCant && <p className="vs-error">Эта модель не умеет начинать видео с фото — выберите другую.</p>}
              {mode === "frames" && targetModel && !maryxOnly && !targetModel.lastFrame && (
                <p className="vs-error">Эта модель не умеет заканчивать видео на втором кадре — выберите другую.</p>
              )}
              {error && (
                <p role="alert" className="vs-error">
                  {error}
                </p>
              )}

              <div className="vs-generate">
                {maryxOnly ? <MaryxBadge /> : <ModelPicker models={models} value={choice} onChange={setSaved} loading={loading} />}
                <button type="button" onClick={submit} disabled={!ready || Boolean(modelCant)} className="maryx-button vs-go">
                  <WandSparkles size={17} />
                  {BUTTON[mode]}
                  {count > 1 && <span className="vs-go-count">×{count}</span>}
                </button>
              </div>
              <p className="vs-cost">
                {count > 1 ? `${count} видео из лимита` : "1 видео из лимита"} · {duration} с · готово за 1–5 минут, можно уйти со страницы
              </p>
              <input
                ref={fileInput}
                type="file"
                accept="image/*,.heic,.heif"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFrame(file, slot.current);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="vs-results">
              <VideoGallery
                items={items}
                onReuse={reuse}
                onContinue={continueFrom}
                onFrame={takeFrame}
                onDelete={(id) => void removeMedia(id)}
              />
              <PromptGallery
                kind="video"
                prompt={prompt}
                disabled={noProviders}
                onChoose={(value) => {
                  setMode("text");
                  setPrompt(value);
                  toPanel();
                }}
              />
            </div>
          </div>
        )}
        </div>
      </div>
      {presets && (
        <PresetDialog
          tab={presets}
          camera={camera}
          effect={effect}
          onTab={setPresets}
          onCamera={(id) => {
            setCamera(id);
            setPresets(null);
          }}
          onEffect={(id) => {
            setEffect(id);
            // Effects go on one first frame, not on a transition.
            if (id && mode === "frames") setMode("effects");
            setPresets(null);
          }}
          onClose={() => setPresets(null)}
        />
      )}
    </div>
  );
}
