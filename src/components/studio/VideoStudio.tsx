"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  Clapperboard,
  Clock,
  FrameTransition,
  ImagePlus,
  KeyRound,
  Layers3 as Layers,
  LoaderCircle,
  Minus,
  PhotoMotion,
  Plus,
  Recast,
  ScriptVideo,
  Search,
  Sparkles,
  Undo2,
  VideoMagic,
  WandSparkles,
  X,
} from "@/components/MaryxIcons";
import { CAMERA_MOTIONS, VIDEO_EFFECTS } from "@/lib/effects";
import { sendToImageStudio, type Frame } from "@/lib/client/frames";
import { enhancePrompt, generate, removeMedia, useMediaItems } from "@/lib/client/media";
import { useModels } from "@/lib/client/useModels";
import { useStoredJson } from "@/lib/client/useStored";
import { imageToAttachment, MAX_TOTAL_BASE64, nearestRatio } from "@/lib/client/util";
import { TREND_CATEGORIES, VIDEO_TRENDS, type VideoTrend } from "@/lib/video-trends";
import type { AspectRatio, MediaFile, MediaItem, ModelInfo } from "@/lib/types";
import { useApp, type ModelChoice } from "../AppState";
import { BrandMark } from "../Design";
import { findModel } from "../ModelPicker";
import { PresetArt } from "./PresetArt";
import { PromptGallery } from "./PromptGallery";
import { StudioDialog } from "./StudioDialog";
import { TrendStudio } from "./TrendStudio";
import { VideoGallery } from "./VideoGallery";

type Mode = "text" | "photo" | "frames" | "effects";
type Tab = "create" | "trends" | "effects";
type Popover = "model" | "mode" | "camera" | "effect" | "ratio" | "duration" | null;

const MODES: { id: Mode; label: string; Icon: typeof ScriptVideo; hint: string; badge?: string }[] = [
  { id: "text", label: "Текст в видео", Icon: ScriptVideo, hint: "Опишите сцену — MARYX снимет её", badge: "Рекомендуем" },
  { id: "photo", label: "Оживить фото", Icon: PhotoMotion, hint: "Ваше фото станет первым кадром" },
  { id: "frames", label: "Начало и конец", Icon: FrameTransition, hint: "Плавный переход от одного кадра к другому" },
  { id: "effects", label: "Эффекты", Icon: VideoMagic, hint: "Взрыв, левитация, портал — в один клик", badge: "Хит" },
];

const RATIOS: AspectRatio[] = ["16:9", "9:16"];
const DURATIONS = [5, 10];
const MAX_COUNT = 4;

const PLACEHOLDER: Record<Mode, string> = {
  text: "Опишите видео: что происходит, где, какое настроение и звук…",
  photo: "Что происходит на фото? Например: улыбается и машет рукой. Можно оставить пустым",
  frames: "Что происходит между кадрами? Например: день сменяется ночью. Можно оставить пустым",
  effects: "Кто или что в кадре? С фото можно оставить пустым",
};

/** The image studio hands a picture here ("Оживить" on a card): it becomes the first frame. */
const ANIMATE_KEY = "maryx:animate";

async function frameFrom(file: MediaFile): Promise<Frame> {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error("Не удалось загрузить изображение");
  return imageToAttachment(await res.blob());
}

const src = (f: Frame) => `data:${f.mime};base64,${f.data}`;

/** What one clip of a model costs in credits, for its length. */
function clipCredits(model: ModelInfo | undefined, seconds: number): number | undefined {
  return model?.credits && Math.max(model.credits.least, Math.ceil(model.credits.perSecond * seconds));
}

/** A model's maker as a little tile: MARYX's mark, or the maker's first letter. */
function VendorTile({ model }: { model: ModelInfo }) {
  if (model.provider === "maryx") return <BrandMark className="lx-vendor lx-vendor--maryx" />;
  const name = model.vendor ?? model.label;
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="lx-vendor" style={{ "--vendor-hue": hue } as CSSProperties} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** A pill of the composer's bottom row and the panel it opens (upwards, above the composer). */
function Pill({
  label,
  icon,
  open,
  onOpen,
  onClose,
  title,
  disabled,
  children,
  wide,
}: {
  label: ReactNode;
  icon: ReactNode;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  title: string;
  disabled?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open, onClose]);
  return (
    <div className="lx-pill-box" ref={box}>
      <button
        type="button"
        className="lx-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={title}
        disabled={disabled}
        onClick={() => (open ? onClose() : onOpen())}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={13} className="lx-pill-chevron" />
      </button>
      {open && (
        <div className={`lx-pop ${wide ? "lx-pop--wide" : ""}`} role="dialog" aria-label={title}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A camera move or an effect, as a little animated card. */
function PresetTile({ kind, id, label, hint, selected, onClick }: { kind: "camera" | "effect"; id: string; label: string; hint?: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className="preset-card" aria-pressed={selected} onClick={onClick} title={hint}>
      <PresetArt motion={kind === "camera" ? id : undefined} effect={kind === "effect" ? id : undefined} live={selected} />
      <span className="preset-card-symbol" aria-hidden="true">
        {kind === "camera" ? <Camera size={14} /> : <VideoMagic size={14} />}
      </span>
      <span className="preset-card-label">
        {label}
        {selected && <Check size={13} />}
      </span>
    </button>
  );
}

/** A ready-made trend: the user's photo in, a vertical clip out. */
function TrendSheet({ trend, onClose, onMake }: { trend: VideoTrend; onClose: () => void; onMake: (photo: Frame, extra: string) => void }) {
  const [photo, setPhoto] = useState<Frame | undefined>();
  const [extra, setExtra] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const read = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const frame = await imageToAttachment(file);
      if ((frame.data?.length ?? 0) > MAX_TOTAL_BASE64) setError("Фото слишком большое: до 3 МБ.");
      else setPhoto(frame);
    } catch {
      setError(`Не удалось прочитать «${file.name}» — сохраните его как JPEG или PNG.`);
    }
    setReading(false);
  };
  return (
    <StudioDialog title={trend.title} className="lx-trend-sheet" onClose={onClose}>
      <button type="button" className="vs-icon-button lx-sheet-close" onClick={onClose} aria-label="Закрыть">
        <X size={18} />
      </button>
      <div className="lx-trend-sheet-art" data-cat={trend.category}>
        <PresetArt motion={trend.camera} effect={trend.effect} live />
        {trend.hit && <span className="lx-hit">ХИТ</span>}
      </div>
      <div className="lx-trend-sheet-body">
        <h2>{trend.title}</h2>
        <p>{trend.hint}. Загрузите своё фото — MARYX сделает вертикальное видео в этом тренде.</p>
        <button type="button" className="lx-photo-drop" onClick={() => input.current?.click()} aria-label={photo ? "Заменить фото" : "Загрузить своё фото"}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local data URL
            <img src={src(photo)} alt="Ваше фото" />
          ) : reading ? (
            <LoaderCircle className="size-6 animate-spin" />
          ) : (
            <>
              <ImagePlus size={26} />
              <span>Загрузить своё фото</span>
              <small>Лицо крупно и хорошо освещено</small>
            </>
          )}
        </button>
        <input ref={input} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ""; }} />
        <input className="lx-sheet-extra" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Добавить своё (необязательно)" aria-label="Добавить своё к тренду" maxLength={300} />
        <label className="trend-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>На фото — я или человек (питомец), который разрешил использовать своё фото. Фото детей не загружаю.</span>
        </label>
        {error && <p role="alert" className="vs-error">{error}</p>}
        <button type="button" className="maryx-button lx-sheet-go" disabled={!photo || !consent} onClick={() => photo && onMake(photo, extra.trim())}>
          <WandSparkles size={17} /> Сделать видео · 1 из лимита
        </button>
      </div>
    </StudioDialog>
  );
}

/**
 * «Видео» (like Lexy): three tabs — make a clip from words or photos with the
 * composer at the bottom, ready-made trends from one photo, and effects — and
 * the finished clips above the composer.
 */
export function VideoStudio() {
  const { me } = useApp();
  const router = useRouter();
  const { data } = useModels("video");
  const models = useMemo(() => data?.models ?? [], [data]);
  const items = useMediaItems("video");
  const [saved, setSaved] = useStoredJson<ModelChoice>("maryx:video-model");

  const [tab, setTab] = useState<Tab>("create");
  const [remix, setRemix] = useState(false);
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
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pop, setPop] = useState<Popover>(null);
  const [modeTab, setModeTab] = useState<"video" | "effects">("video");
  const [search, setSearch] = useState("");
  const [continuing, setContinuing] = useState<string | null>(null);
  const [trendFilter, setTrendFilter] = useState<(typeof TREND_CATEGORIES)[number]["id"]>("all");
  const [trendQuery, setTrendQuery] = useState("");
  const [trend, setTrend] = useState<VideoTrend | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLDivElement>(null);

  const photoOk = models.some((m) => m.photoEdit);
  const lastFrameOk = models.some((m) => m.photoEdit && m.lastFrame);
  const noProviders = data !== null && models.length === 0;
  // MARYX Ai Video (first in the list) unless the user picked a model by hand.
  const fallback = models.find((m) => m.featured) ?? models[0];
  const target: ModelChoice | null = saved && findModel(models, saved) ? saved : fallback ? { provider: fallback.provider, model: fallback.id } : null;
  const targetModel = target ? findModel(models, target) : undefined;
  const ours = models.filter((m) => m.provider === "maryx");
  const theirs = models.filter((m) => m.provider !== "maryx");
  const price = clipCredits(targetModel, duration);
  /** What a clip was made with: its model's name, or MARYX Ai Video. */
  const labelOf = (item: MediaItem) =>
    item.provider === "maryx" ? (ours[0]?.label ?? "MARYX Ai Video") : (findModel(models, { provider: item.provider, model: item.model })?.label ?? item.model);

  const frames = mode === "text" ? [] : mode === "frames" ? [start, end].filter((f): f is Frame => Boolean(f)) : start ? [start] : [];
  const withPhoto = frames.length > 0;
  const ready =
    Boolean(me && target && !reading) &&
    (mode === "text" ? prompt.trim().length > 0 : mode === "photo" ? Boolean(start) : mode === "frames" ? Boolean(start && end) : Boolean(effect && (start || prompt.trim())));
  const modelCant = withPhoto && targetModel && (!targetModel.photoEdit || (mode === "frames" && !targetModel.lastFrame));
  const usage = me?.usage.video;
  const left = usage && usage.limit !== null ? Math.max(0, usage.limit - usage.used) : null;
  const current = MODES.find((m) => m.id === mode)!;
  const chosenCamera = CAMERA_MOTIONS.find((m) => m.id === camera);
  const chosenEffect = VIDEO_EFFECTS.find((e) => e.id === effect);

  const readFrame = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
      setError("Можно загрузить только фото (JPEG, PNG, WebP, HEIC).");
      return;
    }
    setReading(true);
    try {
      const frame = await imageToAttachment(file);
      // The first photo starts the clip; with «Начало и конец», the second ends it.
      const second = mode === "frames" && start && !end;
      if ((frame.data?.length ?? 0) + (second ? (start?.data?.length ?? 0) : 0) > MAX_TOTAL_BASE64) {
        setError("Фото слишком большие: всего до 3 МБ за раз.");
      } else if (second) setEnd(frame);
      else {
        setStart(frame);
        setContinuing(null);
        if (mode === "text") setMode("photo");
      }
    } catch {
      setError(`Не удалось прочитать «${file.name}» — сохраните его как JPEG или PNG.`);
    }
    setReading(false);
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

  /** Back to the composer, the cursor in the description. */
  const toComposer = () => {
    setTab("create");
    requestAnimationFrame(() => {
      composer.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      promptRef.current?.focus({ preventScroll: true });
    });
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

  const makeTrend = (t: VideoTrend, photo: Frame, extra: string) => {
    if (!target) return;
    void generate({
      kind: "video",
      ...target,
      prompt: [`Тренд «${t.title}»: ${t.prompt}`, extra].filter(Boolean).join(". "),
      aspectRatio: nearestRatio(photo.width, photo.height, RATIOS),
      images: [{ mime: photo.mime, data: photo.data! }],
      ...(t.camera ? { camera: t.camera } : {}),
      ...(t.effect ? { effect: t.effect } : {}),
      duration: 5,
    });
    setTrend(null);
    setTab("create");
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

  const chooseMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPop(null);
    if (next !== "frames") setEnd(undefined);
  };

  /** "Повторить": the clip's words, frames and settings back in the composer. */
  const reuse = (item: MediaItem) => {
    const auto = /^(Оживить фото|Переход между кадрами|Эффект «)/.test(item.prompt);
    setPrompt(auto ? "" : item.prompt);
    setBefore(null);
    setCamera(item.camera ?? null);
    setEffect(item.effect ?? null);
    setDuration(item.duration && DURATIONS.includes(item.duration) ? item.duration : 5);
    if (RATIOS.includes(item.aspectRatio)) setRatio(item.aspectRatio);
    // The same model, while it's offered (a clip MARYX made: MARYX Ai Video).
    const same = item.provider === "maryx" ? ours[0] : findModel(models, { provider: item.provider, model: item.model });
    if (same) setSaved({ provider: same.provider, model: same.id });
    setContinuing(null);
    const inputs = item.inputs ?? [];
    setMode(item.effect ? "effects" : inputs.length > 1 ? "frames" : inputs.length ? "photo" : "text");
    setStart(undefined);
    setEnd(undefined);
    if (inputs.length) {
      setReading(true);
      Promise.all(inputs.slice(0, 2).map(frameFrom)).then(
        ([first, second]) => {
          setStart(first);
          setEnd(second);
          setReading(false);
        },
        () => {
          setError("Не удалось загрузить кадры — загрузите фото заново.");
          setReading(false);
        },
      );
    }
    toComposer();
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
    toComposer();
  };

  const takeFrame = (frame: Frame, to: "video" | "image") => {
    if (to === "image") {
      if (sendToImageStudio(frame)) router.push("/images");
      else setError("Браузер не дал передать кадр — скачайте его и загрузите в студии картинок.");
      return;
    }
    setMode("photo");
    setStart(frame);
    setContinuing(null);
    toComposer();
  };

  const q = search.trim().toLowerCase();
  const matches = (...texts: (string | undefined)[]) => !q || texts.some((t) => t?.toLowerCase().includes(q));
  const tq = trendQuery.trim().toLowerCase();
  const trends = VIDEO_TRENDS.filter(
    (t) => (trendFilter === "all" || (trendFilter === "hit" ? t.hit : t.category === trendFilter)) && (!tq || `${t.title} ${t.hint}`.toLowerCase().includes(tq)),
  );

  const modeDisabled = (id: Mode) => (id === "photo" && !photoOk) || (id === "frames" && !lastFrameOk);

  return (
    <div className="lx-studio h-full overflow-y-auto">
      <div className="lx-top">
        <div role="tablist" aria-label="Разделы видео" className="lx-tabs">
          {(
            [
              ["create", "Создать", null],
              ["trends", "Тренды", "Топ"],
              ["effects", "Эффекты", null],
            ] as const
          ).map(([id, label, badge]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setRemix(false); }}>
              {label}
              {badge && <span className="lx-badge lx-badge--top">{badge}</span>}
            </button>
          ))}
        </div>
        {left !== null && (
          <span className="lx-quota" title="Видео на сегодня по вашему тарифу">
            <Clapperboard size={14} /> Сегодня осталось: {left}
          </span>
        )}
      </div>

      {noProviders ? (
        <div className="lx-body">
          <div className="empty-notice mt-6 rounded-2xl border p-5 text-sm text-zinc-200">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <KeyRound className="size-4" /> Видео пока не подключено
            </div>
            {me?.admin ? (
              <p className="text-zinc-400">
                Добавьте OPENROUTER_API_KEY (или свой GPU: COMFYUI_URL) в переменные окружения сервера.{" "}
                <Link href="/settings" className="font-medium text-violet-200 underline">
                  Настройки →
                </Link>
              </p>
            ) : (
              <p className="text-zinc-400">Эта функция скоро появится.</p>
            )}
          </div>
        </div>
      ) : tab === "trends" ? (
        <div className="lx-body">
          {remix ? (
            <>
              <button type="button" className="lx-back" onClick={() => setRemix(false)}>
                ← Все тренды
              </button>
              <TrendStudio />
            </>
          ) : (
            <section aria-label="Тренды">
              <h1 className="lx-title">Тренды</h1>
              <p className="lx-sub">Готовые тренды для быстрых видео — без подбора промпта. Выберите тренд и загрузите своё фото.</p>
              <label className="lx-search">
                <Search size={16} />
                <input value={trendQuery} onChange={(e) => setTrendQuery(e.target.value)} placeholder="Найти тренд" aria-label="Поиск трендов" />
              </label>
              <div role="group" aria-label="Категории трендов" className="lx-chips">
                {TREND_CATEGORIES.map((c) => (
                  <button key={c.id} type="button" aria-pressed={trendFilter === c.id} onClick={() => setTrendFilter(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
              <ul className="lx-trend-grid">
                {!tq && trendFilter === "all" && (
                  <li>
                    <button type="button" className="lx-trend lx-trend--remix" onClick={() => setRemix(true)}>
                      <span className="lx-trend-remix-art">
                        <Recast size={34} />
                      </span>
                      <span className="lx-badge lx-badge--new">Новое</span>
                      <span className="lx-trend-copy">
                        <strong>Повторить свой тренд</strong>
                        <small>Загрузите любой ролик из TikTok или Reels — MARYX повторит его с вами</small>
                      </span>
                    </button>
                  </li>
                )}
                {trends.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="lx-trend" data-cat={t.category} onClick={() => setTrend(t)} aria-label={t.title}>
                      <PresetArt motion={t.camera} effect={t.effect} />
                      {t.hit && <span className="lx-hit">ХИТ</span>}
                      <span className="lx-trend-copy">
                        <strong>{t.title}</strong>
                        <small>{t.hint}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!trends.length && <p className="lx-sub">Ничего не нашлось — попробуйте другое слово.</p>}
            </section>
          )}
        </div>
      ) : tab === "effects" ? (
        <div className="lx-body">
          <section aria-label="Эффекты">
            <h1 className="lx-title">Эффекты</h1>
            <p className="lx-sub">Эффект в один клик: загрузите фото — и оно оживёт с этим эффектом. Можно добавить движение камеры.</p>
            <ul className="lx-effect-grid">
              {VIDEO_EFFECTS.map((e) => (
                <li key={e.id} className="lx-effect">
                  <PresetArt effect={e.id} />
                  <div className="lx-effect-copy">
                    <strong>{e.label}</strong>
                    <small>{e.hint}</small>
                  </div>
                  <button
                    type="button"
                    className="lx-try"
                    aria-label={`Попробовать: ${e.label}`}
                    onClick={() => {
                      setEffect(e.id);
                      setMode("effects");
                      setEnd(undefined);
                      toComposer();
                    }}
                  >
                    Попробовать ▸
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <>
          <div className="lx-body">
            {items.length ? (
              <VideoGallery items={items} labelOf={labelOf} onReuse={reuse} onContinue={continueFrom} onFrame={takeFrame} onDelete={(id) => void removeMedia(id)} />
            ) : (
              <section className="lx-start" aria-label="Как создать видео">
                <h1>Создайте первое видео</h1>
                <p>Всего три шага от идеи до готового ролика.</p>
                <ol className="lx-steps">
                  <li>
                    <div className="lx-step-art">
                      <span className="lx-step-switch">
                        <span>Текст</span>
                        <span data-on>Фото</span>
                        <span>Эффекты</span>
                      </span>
                    </div>
                    <small>Шаг 1</small>
                    <strong>Выберите режим</strong>
                    <span>Текст, своё фото, два кадра или эффект.</span>
                  </li>
                  <li>
                    <div className="lx-step-art">
                      <span className="lx-step-typing">Портрет у моря в мягком вечернем свете</span>
                    </div>
                    <small>Шаг 2</small>
                    <strong>Опишите идею</strong>
                    <span>Напишите, что происходит, и загрузите фото, если нужно.</span>
                  </li>
                  <li>
                    <div className="lx-step-art lx-step-fan">
                      <PresetArt motion="orbit" />
                      <PresetArt effect="petals" live />
                      <PresetArt motion="drone" />
                    </div>
                    <small>Шаг 3</small>
                    <strong>Получите результат</strong>
                    <span>Видео появится здесь — можно уйти со страницы.</span>
                  </li>
                </ol>
                <PromptGallery
                  kind="video"
                  prompt={prompt}
                  disabled={noProviders}
                  onChoose={(value) => {
                    setMode("text");
                    setPrompt(value);
                    toComposer();
                  }}
                />
              </section>
            )}
          </div>

          <div className="lx-dock">
            <div ref={composer} className="lx-composer" aria-label="Создать видео">
              {(start || end || continuing) && (
                <div className="lx-attachments">
                  {start && (
                    <span className="lx-attachment">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
                      <img src={src(start)} alt="Фото для видео" />
                      <small>{mode === "frames" ? "Начало" : "Первый кадр"}</small>
                      <button type="button" aria-label="Убрать фото" onClick={() => { setStart(undefined); setEnd(undefined); setContinuing(null); }}>
                        <X size={12} />
                      </button>
                    </span>
                  )}
                  {end && (
                    <span className="lx-attachment">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
                      <img src={src(end)} alt="Последний кадр" />
                      <small>Конец</small>
                      <button type="button" aria-label="Убрать последний кадр" onClick={() => setEnd(undefined)}>
                        <X size={12} />
                      </button>
                    </span>
                  )}
                  {mode === "frames" && start && !end && (
                    <button type="button" className="lx-attachment lx-attachment--add" onClick={() => fileInput.current?.click()} aria-label="Загрузить конец">
                      <Plus size={16} />
                      <small>Конец</small>
                    </button>
                  )}
                  {continuing && start && (
                    <span className="lx-note">
                      <Layers size={13} /> Продолжение видео «{continuing.slice(0, 50)}»: опишите, что дальше
                    </span>
                  )}
                  {mode === "frames" && start && end && <span className="lx-note">Переход между кадрами</span>}
                </div>
              )}
              <div className="lx-input">
                <button
                  type="button"
                  className="lx-plus"
                  onClick={() => fileInput.current?.click()}
                  disabled={reading || (mode === "frames" ? Boolean(start && end) : false)}
                  aria-label={mode === "frames" && start ? "Загрузить конец" : "Загрузить начальный кадр"}
                  title="Добавить фото: оно станет первым кадром"
                >
                  {reading ? <LoaderCircle className="size-4 animate-spin" /> : <Plus size={18} />}
                </button>
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setBefore(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={2}
                  maxLength={4000}
                  placeholder={continuing ? "Что происходит дальше? Например: герой оборачивается и идёт к морю" : PLACEHOLDER[mode]}
                  aria-label="Описание видео"
                />
                <div className="lx-input-tools">
                  {before !== null && !enhancing && (
                    <button type="button" onClick={() => { setPrompt(before); setBefore(null); }} title="Вернуть как было" aria-label="Вернуть как было">
                      <Undo2 size={15} />
                    </button>
                  )}
                  <button type="button" onClick={() => void enhance()} disabled={!prompt.trim() || enhancing} title="Улучшить промпт: MARYX превратит идею в подробное описание" aria-label="Улучшить промпт">
                    {enhancing ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles size={15} />}
                  </button>
                </div>
              </div>

              <div className="lx-controls">
                {targetModel && (
                  <Pill
                    title={`Модель: ${targetModel.label}`}
                    icon={<VendorTile model={targetModel} />}
                    label={targetModel.label}
                    open={pop === "model"}
                    onOpen={() => { setPop("model"); setSearch(""); }}
                    onClose={() => setPop(null)}
                    wide
                  >
                    {models.length > 6 && (
                      <label className="lx-pop-search">
                        <Search size={15} />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск моделей" aria-label="Поиск моделей" autoFocus />
                      </label>
                    )}
                    <div className="lx-pop-list lx-models" role="radiogroup" aria-label="Модель">
                      {[
                        { title: "Наша модель", list: ours },
                        { title: "Провайдеры", list: theirs },
                      ].map(({ title, list }) => {
                        const shown = list.filter((m) => matches(m.label, `${m.vendor ?? ""} ${m.id}`));
                        if (!shown.length) return null;
                        return (
                          <div key={title} className="contents">
                            <h3>{title}</h3>
                            {shown.map((m) => {
                              const on = target?.model === m.id && target.provider === m.provider;
                              const cost = clipCredits(m, duration);
                              const can = [m.photoEdit && "фото → видео", m.lastFrame && "начало и конец", m.motion && "повтор движений"].filter(Boolean).join(" · ");
                              return (
                                <button
                                  key={`${m.provider}:${m.id}`}
                                  type="button"
                                  role="radio"
                                  aria-checked={on}
                                  className="lx-row lx-model"
                                  onClick={() => { setSaved({ provider: m.provider, model: m.id }); setPop(null); setError(null); }}
                                >
                                  <VendorTile model={m} />
                                  <span>
                                    <strong>
                                      {m.label}
                                      {m.provider === "maryx" ? <em className="lx-badge">Сам выбирает</em> : m.vendor && <em className="lx-model-vendor">{m.vendor}</em>}
                                    </strong>
                                    <small>
                                      {m.description ?? "Видео по описанию"}
                                      {can && <> · {can}</>}
                                    </small>
                                  </span>
                                  {cost !== undefined && (
                                    <span className="lx-model-cost" title={`Цена ролика ${duration} с за кредиты. По тарифу — 1 видео из лимита; дорогие модели быстрее расходуют месячный бюджет тарифа на видео.`}>
                                      {m.provider === "maryx" ? "от " : "≈ "}
                                      {cost.toLocaleString("ru-RU")} кр.
                                    </span>
                                  )}
                                  {on && <Check size={15} />}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                    <p className="lx-models-note">
                      MARYX Ai Video сам выбирает нейросеть под запрос и, если она не справилась, пробует другую. Модель, выбранная вручную, снимает сама.
                    </p>
                  </Pill>
                )}
                <Pill
                  title={`Режим: ${current.label}`}
                  icon={<current.Icon size={15} />}
                  label={current.label}
                  open={pop === "mode"}
                  onOpen={() => { setPop("mode"); setSearch(""); }}
                  onClose={() => setPop(null)}
                  wide
                >
                  <div className="lx-pop-tabs" role="tablist" aria-label="Что выбрать">
                    <button type="button" role="tab" aria-selected={modeTab === "video"} onClick={() => setModeTab("video")}>Видео</button>
                    <button type="button" role="tab" aria-selected={modeTab === "effects"} onClick={() => setModeTab("effects")}>Эффекты</button>
                  </div>
                  <label className="lx-pop-search">
                    <Search size={15} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск режимов и эффектов" aria-label="Поиск режимов и эффектов" autoFocus />
                  </label>
                  <div className="lx-pop-list">
                    {modeTab === "video" ? (
                      <>
                        <h3>Основное</h3>
                        {MODES.filter((m) => matches(m.label, m.hint)).map((m) => (
                          <button key={m.id} type="button" className="lx-row" aria-pressed={mode === m.id} disabled={modeDisabled(m.id)} onClick={() => chooseMode(m.id)} title={modeDisabled(m.id) ? "Подключённые модели этого пока не умеют" : undefined}>
                            <m.Icon size={18} />
                            <span>
                              <strong>
                                {m.label}
                                {m.badge && <em className="lx-badge">{m.badge}</em>}
                              </strong>
                              <small>{m.hint}</small>
                            </span>
                            {mode === m.id && <Check size={15} />}
                          </button>
                        ))}
                        {matches("Тренды", "готовые тренды повтор") && (
                          <button type="button" className="lx-row" onClick={() => { setPop(null); setTab("trends"); }}>
                            <Recast size={18} />
                            <span>
                              <strong>
                                Тренды<em className="lx-badge lx-badge--top">Топ</em>
                              </strong>
                              <small>Готовые тренды из одного фото и повтор вашего ролика</small>
                            </span>
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <h3>Эффекты</h3>
                        {VIDEO_EFFECTS.filter((e) => matches(e.label, e.hint)).map((e) => (
                          <button key={e.id} type="button" className="lx-row lx-row--art" aria-pressed={effect === e.id} onClick={() => { setEffect(e.id); if (mode === "text" || mode === "frames") setMode("effects"); setPop(null); }}>
                            <PresetArt effect={e.id} />
                            <span>
                              <strong>{e.label}</strong>
                              <small>{e.hint}</small>
                            </span>
                            {effect === e.id && <Check size={15} />}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </Pill>

                <Pill title="Движение камеры" icon={<Camera size={15} />} label={chosenCamera?.label ?? "Камера"} open={pop === "camera"} onOpen={() => setPop("camera")} onClose={() => setPop(null)} wide>
                  <div className="lx-pop-grid">
                    <button type="button" className="preset-card preset-card--none" aria-pressed={camera === null} onClick={() => { setCamera(null); setPop(null); }}>
                      <span className="preset-none-art">
                        <X size={22} />
                      </span>
                      <span className="preset-card-label">Без движения</span>
                    </button>
                    {CAMERA_MOTIONS.map((m) => (
                      <PresetTile key={m.id} kind="camera" id={m.id} label={m.label} hint={m.hint} selected={camera === m.id} onClick={() => { setCamera(m.id); setPop(null); }} />
                    ))}
                  </div>
                </Pill>

                {mode !== "frames" && (
                  <Pill title="Эффект" icon={<VideoMagic size={15} />} label={chosenEffect?.label ?? "Эффект"} open={pop === "effect"} onOpen={() => setPop("effect")} onClose={() => setPop(null)} wide>
                    <div className="lx-pop-grid">
                      <button type="button" className="preset-card preset-card--none" aria-pressed={effect === null} onClick={() => { setEffect(null); if (mode === "effects") setMode(start ? "photo" : "text"); setPop(null); }}>
                        <span className="preset-none-art">
                          <X size={22} />
                        </span>
                        <span className="preset-card-label">Без эффекта</span>
                      </button>
                      {VIDEO_EFFECTS.map((e) => (
                        <PresetTile key={e.id} kind="effect" id={e.id} label={e.label} hint={e.hint} selected={effect === e.id} onClick={() => { setEffect(e.id); if (mode === "text") setMode("effects"); setPop(null); }} />
                      ))}
                    </div>
                  </Pill>
                )}

                <Pill title={withPhoto ? "Формат: как у фото" : `Формат: ${ratio}`} icon={<span className={`vs-ratio vs-ratio-${(withPhoto ? "9:16" : ratio).replace(":", "x")}`} aria-hidden="true" />} label={withPhoto ? "Как у фото" : ratio} open={pop === "ratio"} onOpen={() => setPop("ratio")} onClose={() => setPop(null)} disabled={withPhoto}>
                  <div role="radiogroup" aria-label="Формат" className="lx-pop-options">
                    {RATIOS.map((r) => (
                      <button key={r} type="button" role="radio" aria-checked={ratio === r} onClick={() => { setRatio(r); setPop(null); }}>
                        <span className={`vs-ratio vs-ratio-${r.replace(":", "x")}`} aria-hidden="true" />
                        {r === "16:9" ? "16:9 · горизонтальное" : "9:16 · вертикальное"}
                      </button>
                    ))}
                  </div>
                </Pill>

                <Pill title={`Длительность: ${duration} с`} icon={<Clock size={15} />} label={`${duration} с`} open={pop === "duration"} onOpen={() => setPop("duration")} onClose={() => setPop(null)}>
                  <div role="radiogroup" aria-label="Длительность" className="lx-pop-options">
                    {DURATIONS.map((d) => (
                      <button key={d} type="button" role="radio" aria-checked={duration === d} onClick={() => { setDuration(d); setPop(null); }}>
                        {d} секунд
                      </button>
                    ))}
                  </div>
                </Pill>

                <div className="lx-go">
                  <div className="lx-stepper" role="group" aria-label="Сколько вариантов" title="Каждый вариант — отдельное видео из лимита">
                    <button type="button" onClick={() => setCount((n) => Math.max(1, n - 1))} disabled={count <= 1} aria-label="Меньше вариантов">
                      <Minus size={14} />
                    </button>
                    <output aria-label="Вариантов">{count}</output>
                    <button type="button" onClick={() => setCount((n) => Math.min(MAX_COUNT, n + 1))} disabled={count >= MAX_COUNT} aria-label="Больше вариантов">
                      <Plus size={14} />
                    </button>
                  </div>
                  <button type="button" onClick={submit} disabled={!ready || Boolean(modelCant)} className="lx-create" aria-label={`Создать${count > 1 ? ` ×${count}` : ""}`}>
                    {ready ? "Создать" : mode === "text" ? "Опишите видео" : mode === "photo" ? "Добавьте фото" : mode === "frames" ? "Добавьте два кадра" : "Выберите эффект"}
                    <span className="lx-cost">{count} <Clapperboard size={12} /></span>
                  </button>
                </div>
              </div>
              {modelCant && (
                <p className="vs-error">
                  {targetModel?.photoEdit ? "Эта модель не умеет переход между двумя кадрами" : "Эта модель не умеет начинать видео с фото"} — выберите другую.
                </p>
              )}
              {error && (
                <p role="alert" className="vs-error">
                  {error}
                </p>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/*,.heic,.heif"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFrame(file);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="lx-dock-note">
              {targetModel && `${targetModel.label} · `}
              {count > 1 ? `${count} видео из лимита` : "1 видео из лимита"}
              {price !== undefined && ` или ${targetModel?.provider === "maryx" ? "от " : "≈ "}${(price * count).toLocaleString("ru-RU")} кр.`} · {duration} с · готово за 1–5 минут, можно уйти со страницы
            </p>
          </div>
        </>
      )}
      {trend && <TrendSheet trend={trend} onClose={() => setTrend(null)} onMake={(photo, extra) => makeTrend(trend, photo, extra)} />}
    </div>
  );
}
