"use client";

import { Clapperboard, Image as ImageIcon, ImagePlus, KeyRound, LoaderCircle, WandSparkles, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
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
    maryx: "MARYX создаёт видео за 1–5 минут — можно уйти со страницы, результат сохранится.",
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

/** Photo editing (image studio): what to ask for once a photo is loaded. */
const EDIT = {
  label: "Что сделать с фото",
  placeholder: "Например: естественная ретушь — ровный тон кожи, без бликов, черты лица без изменений",
  ideas: [
    "Естественная ретушь: ровный тон кожи, без бликов, черты лица без изменений",
    "Заменить фон на однотонный студийный",
    "Сделать фото светлее и чётче, без эффекта фильтра",
    "Превратить фото в акварельный портрет",
  ],
};
const MAX_PHOTOS = 4;
/** A prompt that asks to edit "my photo" while none is loaded. */
const ASKS_FOR_PHOTO = /(обработ|отретуш|ретуш|на (нём|нем|ней) я|мо[её] фото|с моего фото|моё лицо|мое лицо)/i;

type Photo = Attachment & { width: number; height: number };

/** Loads a stored picture (a result, or an earlier source photo) to edit it. */
async function photoFrom(file: MediaFile): Promise<Photo> {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error("Не удалось загрузить изображение");
  return imageToAttachment(await res.blob());
}

export function MediaStudio({ kind }: { kind: MediaKind }) {
  const { me, maryxOnly } = useApp();
  const copy = COPY[kind];
  const { data, loading } = useModels(kind);
  const models = useMemo(() => data?.models ?? [], [data]);
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

  // Photo editing: offered when a model edits photos (MARYX: when one of its models does).
  const editable = kind === "image" && models.some((m) => m.photoEdit);
  const editing = editable && photos.length > 0;
  const targetEdits = Boolean(!custom && target && findModel(models, target)?.photoEdit);
  // Not before the profile says which mode the site is in (it decides the model).
  const canGenerate = Boolean(me && target && !reading && (editing ? targetEdits : prompt.trim()));

  const addPhotos = async (files: File[]) => {
    setPhotoError(null);
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    const problems: string[] = [];
    if (images.length < files.length) problems.push("Можно загрузить только фото (JPEG, PNG, WebP, HEIC).");
    const room = MAX_PHOTOS - photos.length;
    if (images.length > room) problems.push(`Не больше ${MAX_PHOTOS} фото за раз.`);
    let total = photos.reduce((sum, p) => sum + (p.data?.length ?? 0), 0);
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
    setPhotos((list) => [...list, ...added]);
    if (problems.length) setPhotoError([...new Set(problems)].join(" "));
  };

  /** Puts stored pictures in as the photos to edit (a result to edit further, or an item's sources). */
  const loadPhotos = async (files: MediaFile[]) => {
    setPhotoError(null);
    setReading(true);
    try {
      setPhotos(await Promise.all(files.slice(0, MAX_PHOTOS).map(photoFrom)));
    } catch {
      setPhotoError("Не удалось загрузить фото — попробуйте ещё раз.");
    }
    setReading(false);
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
      aspectRatio: editing ? nearestRatio(photos[0].width, photos[0].height, RATIOS.image) : ratio,
      ...(editing ? { images: photos.map((p) => ({ mime: p.mime, data: p.data! })) } : {}),
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
  const ideas = editing ? EDIT.ideas : copy.ideas;

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
              {editable ? "Опишите то, что представляете, или загрузите своё фото." : "Опишите то, что представляете. Остальное — дело ИИ."}
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
            <div className="section-label mb-3 px-2">{editing ? EDIT.label : "Опишите вашу идею"}</div>
            {(photos.length > 0 || reading) && (
              <div className="flex flex-wrap gap-2 px-2 pb-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                    <img
                      src={`data:${p.mime};base64,${p.data}`}
                      alt={i === 0 ? "Фото для обработки" : "Дополнительное фото"}
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
              placeholder={editing ? EDIT.placeholder : copy.placeholder}
              aria-label={editing ? EDIT.placeholder : copy.placeholder}
              className="w-full resize-none bg-transparent px-2 py-1 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            {editable && !photos.length && !reading && ASKS_FOR_PHOTO.test(prompt) && (
              <p className="px-2 pb-2 text-xs text-violet-200">
                Чтобы MARYX обработал ваше фото, загрузите его кнопкой «Фото».
              </p>
            )}
            {editing && !targetEdits && (
              <p className="px-2 pb-2 text-xs text-red-300">Эта модель не умеет обрабатывать фото — выберите другую.</p>
            )}
            {photoError && <p className="px-2 pb-2 text-xs text-red-300">{photoError}</p>}
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
                    multiple
                    hidden
                    onChange={(e) => {
                      void addPhotos([...(e.target.files ?? [])]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={reading || photos.length >= MAX_PHOTOS}
                    title="Загрузите своё фото — MARYX его обработает"
                    className="flex items-center gap-1.5 rounded-xl bg-black/30 px-3 py-1.5 text-xs text-zinc-300 transition hover:text-zinc-100 disabled:opacity-40"
                  >
                    <ImagePlus className="size-4" />
                    Фото
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
                {editing ? "Обработать" : "Сгенерировать"}
              </button>
            </div>
          </div>
        )}

        {!noProviders && !prompt && (
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
                  // An edit is repeated on the same photos.
                  if (item.inputs?.length && editable) void loadPhotos(item.inputs);
                  else setPhotos([]);
                  focusPrompt();
                }}
                onEdit={
                  editable && item.files[0]
                    ? () => {
                        setPrompt("");
                        void loadPhotos([item.files[0]]);
                        focusPrompt();
                      }
                    : undefined
                }
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
