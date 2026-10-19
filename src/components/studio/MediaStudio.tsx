"use client";

import { Clapperboard, Image as ImageIcon, ImagePlus, KeyRound, LoaderCircle, WandSparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { CAMERA_MOTIONS, PHOTO_EFFECTS } from "@/lib/effects";
import { generate, removeMedia, useMediaItems } from "@/lib/client/media";
import { useModels } from "@/lib/client/useModels";
import { useStoredJson } from "@/lib/client/useStored";
import { imageToAttachment, MAX_TOTAL_BASE64, nearestRatio } from "@/lib/client/util";
import type { AspectRatio, Attachment, MediaFile, MediaKind } from "@/lib/types";
import { useApp, type ModelChoice } from "../AppState";
import { findModel, MaryxBadge, ModelPicker } from "../ModelPicker";
import { MediaCard } from "./MediaCard";
import { OrbitArt, PageHeading } from "../Design";

const COPY: Record<MediaKind, { title: string; subtitle: string; maryx: string; placeholder: string; ideas: string[] }> = {
  image: {
    title: "Генерация изображений",
    subtitle: "GPT Image, Nano Banana, Imagen, FLUX, Ideogram и другие модели в одном месте.",
    maryx: "MARYX сам подберёт лучший способ воплотить вашу идею — или обработает ваше фото.",
    placeholder: "Опишите изображение: что на нём, стиль, освещение, ракурс…",
    ideas: [
      "Уютная кофейня в дождливом Петербурге, вечер, тёплый свет, фотореализм",
      "Логотип для AI-стартапа «MARYX»: минимализм, фиолетовый градиент",
      "Космонавт верхом на лошади на Марсе, кинематографичный кадр, 35 мм",
      "Акварельная иллюстрация лисы в осеннем лесу",
    ],
  },
  video: {
    title: "Генерация видео",
    subtitle: "Veo, Kling, Seedance, Hailuo, Wan. Видео создаётся 1–5 минут — можно уйти со страницы, результат сохранится.",
    maryx: "MARYX снимет видео по описанию или оживит ваше фото за 1–5 минут — можно уйти со страницы, результат сохранится.",
    placeholder: "Опишите сцену: что происходит, движение камеры, атмосфера, звук…",
    ideas: [
      "Дрон медленно пролетает над заснеженными горами на рассвете",
      "Кот в очках печатает на ноутбуке в стиле офисной комедии",
      "Неоновый город будущего ночью, по улицам едут летающие машины",
      "Волны разбиваются о скалы, замедленная съёмка, звук прибоя",
    ],
  },
};

const RATIOS: Record<MediaKind, AspectRatio[]> = {
  image: ["1:1", "16:9", "9:16", "4:3", "3:4"],
  video: ["16:9", "9:16"],
};

/** Once a photo is loaded: what to do with it (images: edit it; video: bring it to life). */
const EDIT: Record<MediaKind, { label: string; placeholder: string; ideas: string[]; upload: string; uploadTitle: string; button: string; cant: string; hint: string }> = {
  image: {
    label: "Что сделать с фото",
    placeholder: "Например: естественная ретушь — ровный тон кожи, без бликов, черты лица без изменений",
    ideas: [],
    upload: "Фото",
    uploadTitle: "Загрузите своё фото — MARYX его обработает",
    button: "Обработать",
    cant: "Эта модель не умеет обрабатывать фото — выберите другую.",
    hint: "Чтобы MARYX обработал ваше фото, загрузите его кнопкой «Фото».",
  },
  video: {
    label: "Как оживить фото",
    placeholder: "Например: улыбается и машет рукой, волосы развевает ветер. Можно оставить пустым",
    ideas: [
      "Улыбается и смотрит в камеру",
      "Лёгкий ветер, волосы и одежда развеваются",
      "Поворачивает голову и подмигивает",
      "Вокруг появляются волшебные искры",
    ],
    upload: "Оживить фото",
    uploadTitle: "Загрузите фото — MARYX превратит его в видео",
    button: "Оживить",
    cant: "Эта модель не умеет оживлять фото — выберите другую.",
    hint: "Чтобы оживить своё фото, загрузите его кнопкой «Оживить фото».",
  },
};
const MAX_PHOTOS: Record<MediaKind, number> = { image: 4, video: 1 };
/** A prompt that asks to change "my photo" while none is loaded. */
const ASKS_FOR_PHOTO = /(обработ|отретуш|ретуш|оживи|анимируй|на (нём|нем|ней) я|мо[её] фото|с моего фото|моё лицо|мое лицо)/i;
/** The image studio hands a picture to the video studio here ("Оживить" on a card). */
const ANIMATE_KEY = "maryx:animate";

type Photo = Attachment & { width: number; height: number };

/** Loads a stored picture (a result, or an earlier source photo) to edit it. */
async function photoFrom(file: MediaFile): Promise<Photo> {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error("Не удалось загрузить изображение");
  return imageToAttachment(await res.blob());
}

const CARD =
  "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition hover:border-violet-300/40 hover:text-zinc-50";

export function MediaStudio({ kind }: { kind: MediaKind }) {
  const { me, maryxOnly } = useApp();
  const router = useRouter();
  const copy = COPY[kind];
  const edit = EDIT[kind];
  const maxPhotos = MAX_PHOTOS[kind];
  const { data, loading } = useModels(kind);
  const models = useMemo(() => data?.models ?? [], [data]);
  // A picture can be brought to life when a video model starts from a photo.
  const canAnimate = Boolean(useModels("video").data?.models.some((m) => m.photoEdit));
  const items = useMediaItems(kind);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>(RATIOS[kind][0]);
  const [saved, setSaved] = useStoredJson<ModelChoice>(`maryx:${kind}-model`);
  const [customModel, setCustomModel] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reading, setReading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Video: how the camera moves (Higgsfield style), sent along as a direction.
  const [camera, setCamera] = useState<string | null>(null);

  const replicateReady = !maryxOnly && (data?.providers.some((p) => p.id === "replicate" && p.configured) ?? false);
  const noProviders = data !== null && models.length === 0 && !replicateReady;

  // The saved choice if it is still available, else the first featured model. Only MARYX
  // is offered: it picks the model itself (the saved choice is kept for the all-models mode).
  const fallback = models.find((m) => m.featured) ?? models[0];
  const choice: ModelChoice | null = maryxOnly
    ? fallback
      ? { provider: fallback.provider, model: fallback.id }
      : null
    : findModel(models, saved) || !fallback
      ? saved
      : { provider: fallback.provider, model: fallback.id };

  const custom = replicateReady ? customModel.trim() : "";
  const target: ModelChoice | null = custom ? { provider: "replicate", model: custom } : choice;

  // Your own photo: offered when a model takes one (MARYX: when one of its models does).
  const editable = models.some((m) => m.photoEdit);
  const editing = editable && photos.length > 0;
  const targetEdits = Boolean(!custom && target && findModel(models, target)?.photoEdit);
  // Not before the profile says which mode the site is in (it decides the model).
  // A photo can go without words (a natural retouch, or natural motion).
  const canGenerate = Boolean(me && target && !reading && (editing ? targetEdits : prompt.trim()));

  const addPhotos = async (files: File[]) => {
    setPhotoError(null);
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    const problems: string[] = [];
    if (images.length < files.length) problems.push("Можно загрузить только фото (JPEG, PNG, WebP, HEIC).");
    // Video starts from one photo: a new one replaces it.
    const kept = maxPhotos === 1 ? [] : photos;
    const room = maxPhotos - kept.length;
    if (images.length > room) problems.push(maxPhotos === 1 ? "Видео начинается с одного фото." : `Не больше ${maxPhotos} фото за раз.`);
    let total = kept.reduce((sum, p) => sum + (p.data?.length ?? 0), 0);
    const added: Photo[] = [];
    setReading(true);
    // One at a time: big phone photos take a lot of memory to decode.
    for (const file of images.slice(0, Math.max(0, room))) {
      try {
        const photo = await imageToAttachment(file);
        if (total + (photo.data?.length ?? 0) > MAX_TOTAL_BASE64) {
          problems.push("Фото слишком большие: всего до 3 МБ за раз.");
          continue;
        }
        total += photo.data?.length ?? 0;
        added.push(photo);
      } catch {
        problems.push(`Не удалось прочитать «${file.name}» — сохраните его как JPEG или PNG.`);
      }
    }
    setReading(false);
    setPhotos((list) => [...(maxPhotos === 1 && added.length ? [] : list), ...added]);
    if (problems.length) setPhotoError([...new Set(problems)].join(" "));
  };

  /** Puts stored pictures in as the photos to edit (a result to edit further, or an item's sources). */
  const loadPhotos = async (files: MediaFile[]) => {
    setPhotoError(null);
    setReading(true);
    try {
      setPhotos(await Promise.all(files.slice(0, maxPhotos).map(photoFrom)));
    } catch {
      setPhotoError("Не удалось загрузить фото — попробуйте ещё раз.");
    }
    setReading(false);
  };

  // A picture sent here from the image studio ("Оживить") becomes the first frame.
  useEffect(() => {
    if (kind !== "video") return;
    let handed: MediaFile | null = null;
    try {
      handed = JSON.parse(sessionStorage.getItem(ANIMATE_KEY) ?? "null") as MediaFile | null;
    } catch {
      // Storage blocked: nothing was handed over.
    }
    if (!handed?.url) return;
    let alive = true;
    photoFrom(handed).then(
      (photo) => {
        if (!alive) return;
        setPhotos([photo]);
        try {
          sessionStorage.removeItem(ANIMATE_KEY);
        } catch {
          // already unreadable
        }
      },
      () => alive && setPhotoError("Не удалось загрузить картинку — попробуйте ещё раз."),
    );
    return () => {
      alive = false;
    };
  }, [kind]);

  const animate = (file: MediaFile) => {
    try {
      sessionStorage.setItem(ANIMATE_KEY, JSON.stringify(file));
    } catch {
      // Storage blocked: the video studio opens without the picture.
    }
    router.push("/video");
  };

  const focusPrompt = () => {
    promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    promptRef.current?.focus();
  };

  // Each click queues a job; its card in the gallery shows the progress.
  const submit = () => {
    if (!canGenerate || !target) return;
    void generate({
      kind,
      ...target,
      prompt: prompt.trim(),
      // With a photo the result keeps its proportions; the ratio only sizes the card.
      aspectRatio: editing ? nearestRatio(photos[0].width, photos[0].height, RATIOS[kind]) : ratio,
      ...(editing ? { images: photos.map((p) => ({ mime: p.mime, data: p.data! })) } : {}),
      ...(kind === "video" && camera ? { camera } : {}),
    });
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length && editable) {
      e.preventDefault();
      void addPhotos(files);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!editable || !e.dataTransfer.files.length) return;
    e.preventDefault();
    void addPhotos([...e.dataTransfer.files]);
  };
  const ideas = editing ? edit.ideas : copy.ideas;

  const labelOf = (provider: string, id: string) =>
    models.find((m) => m.provider === provider && m.id === id)?.label ?? (maryxOnly ? "MARYX" : id);

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-content">
        <PageHeading number={kind === "image" ? "02" : "03"} eyebrow="Творческая студия" title={copy.title} description={maryxOnly ? copy.maryx : copy.subtitle} />
        <div className={`studio-hero ${kind === "video" ? "studio-hero-video" : ""}`}>
          <div>
            <div className="mb-4 flex items-center gap-2 text-[11px] text-violet-200">
              {kind === "image" ? <ImageIcon className="size-4" /> : <Clapperboard className="size-4" />}
              {kind === "image" ? "Воображение становится видимым" : "У каждой идеи есть движение"}
            </div>
            <h2 className="text-[26px] font-medium leading-tight tracking-[-0.04em] text-zinc-100">
              {kind === "image" ? <>От нескольких слов<br />до целого мира.</> : <>Ваш замысел.<br />Следующий кадр.</>}
            </h2>
            <p className="mt-3 text-xs leading-6 text-zinc-400">
              {!editable
                ? "Опишите то, что представляете. Остальное — дело ИИ."
                : kind === "image"
                  ? "Опишите то, что представляете, или загрузите своё фото."
                  : "Опишите сцену — или загрузите фото, и оно оживёт."}
            </p>
          </div>
          <OrbitArt />
        </div>

        {noProviders ? (
          <div className="empty-notice mt-6 rounded-2xl border p-5 text-sm text-zinc-200">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <KeyRound className="size-4" /> Нет подключённых провайдеров для{" "}
              {kind === "image" ? "изображений" : "видео"}
            </div>
            {me?.admin ? (
              <>
                <p className="mb-3 text-zinc-400">
                  {kind === "image"
                    ? "Добавьте OPENAI_API_KEY, GEMINI_API_KEY или REPLICATE_API_TOKEN в переменные окружения сервера."
                    : "Добавьте GEMINI_API_KEY (Veo) или REPLICATE_API_TOKEN в переменные окружения сервера."}
                </p>
                <Link href="/settings" className="font-medium text-violet-200 underline">
                  Открыть настройки →
                </Link>
              </>
            ) : (
              <p className="text-zinc-400">Эта функция скоро появится.</p>
            )}
          </div>
        ) : (
          <div
            className="composer-panel mt-6 rounded-3xl border p-4 md:p-5"
            onDragOver={(e) => editable && e.preventDefault()}
            onDrop={onDrop}
          >
            <div className="section-label mb-3 px-2">{editing ? edit.label : "Опишите вашу идею"}</div>
            {(photos.length > 0 || reading) && (
              <div className="flex flex-wrap gap-2 px-2 pb-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                    <img
                      src={`data:${p.mime};base64,${p.data}`}
                      alt={kind === "video" ? "Фото для видео" : i === 0 ? "Фото для обработки" : "Дополнительное фото"}
                      className="size-16 rounded-xl object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}
                      title="Убрать фото"
                      aria-label="Убрать фото"
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-700 p-0.5 text-zinc-200 hover:bg-zinc-600"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {reading && (
                  <div className="flex size-16 items-center justify-center rounded-xl bg-white/[0.04]">
                    <LoaderCircle className="size-5 animate-spin text-violet-300" />
                  </div>
                )}
              </div>
            )}
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              onPaste={onPaste}
              rows={3}
              placeholder={editing ? edit.placeholder : copy.placeholder}
              aria-label={editing ? edit.placeholder : copy.placeholder}
              className="w-full resize-none bg-transparent px-2 py-1 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            {editable && !photos.length && !reading && ASKS_FOR_PHOTO.test(prompt) && (
              <p className="px-2 pb-2 text-xs text-violet-200">{edit.hint}</p>
            )}
            {editing && !targetEdits && <p className="px-2 pb-2 text-xs text-red-300">{edit.cant}</p>}
            {photoError && <p className="px-2 pb-2 text-xs text-red-300">{photoError}</p>}

            {kind === "video" && (
              <div role="group" aria-label="Движение камеры" className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
                <span className="mr-1 text-xs text-zinc-500">Камера:</span>
                {CAMERA_MOTIONS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={camera === m.id}
                    onClick={() => setCamera((c) => (c === m.id ? null : m.id))}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition ${
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

            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
              {maryxOnly ? (
                <MaryxBadge />
              ) : (
                <div className={custom ? "pointer-events-none opacity-40" : ""}>
                  <ModelPicker models={models} value={choice} onChange={setSaved} loading={loading} />
                </div>
              )}

              {editable && (
                <>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*,.heic,.heif"
                    multiple={maxPhotos > 1}
                    hidden
                    onChange={(e) => {
                      void addPhotos([...(e.target.files ?? [])]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={reading || (maxPhotos > 1 && photos.length >= maxPhotos)}
                    title={edit.uploadTitle}
                    className="flex items-center gap-1.5 rounded-xl bg-black/30 px-3 py-1.5 text-xs text-zinc-300 transition hover:text-zinc-100 disabled:opacity-40"
                  >
                    <ImagePlus className="size-4" />
                    {edit.upload}
                  </button>
                </>
              )}

              {editing ? (
                <span className="text-xs text-zinc-500">Пропорции как у фото</span>
              ) : (
                <div className="flex rounded-xl bg-black/30 p-0.5">
                  {RATIOS[kind].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRatio(r)}
                      className={`rounded-lg px-2.5 py-1 text-xs transition ${
                        ratio === r ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}

              {replicateReady && !editing && (
                <input
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="или любая модель Replicate: owner/name"
                  className="min-w-0 flex-1 rounded-xl bg-black/30 px-3 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 sm:max-w-64"
                />
              )}

              <div className="flex-1" />
              <button
                type="button"
                onClick={submit}
                disabled={!canGenerate}
                className="maryx-button flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
              >
                <WandSparkles className="size-4" />
                {editing ? edit.button : "Сгенерировать"}
              </button>
            </div>
          </div>
        )}

        {/* Higgsfield style: one click puts a ready look on the photo. */}
        {!noProviders && editing && kind === "image" && (
          <div role="group" aria-label="Эффекты" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {PHOTO_EFFECTS.map((e) => (
              <button
                key={e.id}
                type="button"
                title={e.prompt}
                aria-pressed={prompt === e.prompt}
                onClick={() => {
                  setPrompt(e.prompt);
                  promptRef.current?.focus();
                }}
                className={`${CARD} ${
                  prompt === e.prompt
                    ? "border-violet-300/50 bg-violet-500/15 text-violet-100"
                    : "border-white/10 bg-white/[0.03] text-zinc-300"
                }`}
              >
                <span className="text-lg" aria-hidden="true">{e.emoji}</span>
                <span className="font-medium">{e.label}</span>
              </button>
            ))}
          </div>
        )}

        {!noProviders && !prompt && ideas.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {ideas.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => {
                  setPrompt(idea);
                  promptRef.current?.focus();
                }}
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
              >
                {idea}
              </button>
            ))}
          </div>
        )}

        {items.length > 0 ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                modelLabel={labelOf(item.provider, item.model)}
                onReuse={() => {
                  setPrompt(item.prompt);
                  setRatio(RATIOS[kind].includes(item.aspectRatio) ? item.aspectRatio : RATIOS[kind][0]);
                  // An edit (or an animated photo) is repeated on the same photos.
                  if (item.inputs?.length && editable) void loadPhotos(item.inputs);
                  else setPhotos([]);
                  focusPrompt();
                }}
                onEdit={
                  editable && kind === "image" && item.files[0]
                    ? () => {
                        setPrompt("");
                        void loadPhotos([item.files[0]]);
                        focusPrompt();
                      }
                    : undefined
                }
                onAnimate={kind === "image" && canAnimate && item.files[0] ? () => animate(item.files[0]) : undefined}
                onDelete={() => removeMedia(item.id)}
              />
            ))}
          </div>
        ) : (
          <div className="studio-empty mt-8">
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-violet-300/15 bg-violet-300/5 text-violet-300">
              {kind === "image" ? <ImageIcon className="size-5" /> : <Clapperboard className="size-5" />}
            </div>
            <h3 className="text-base font-medium text-zinc-200">Ваша коллекция начинается здесь</h3>
            <p className="mt-2 max-w-xs text-xs leading-6 text-zinc-500">Здесь появятся ваши {kind === "image" ? "изображения" : "видео"}. Создайте что-то, что ещё никто не видел.</p>
          </div>
        )}
      </div>
    </div>
  );
}
