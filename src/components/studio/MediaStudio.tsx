"use client";

import { Clapperboard, Image as ImageIcon, KeyRound, WandSparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { generate, removeMedia, useMediaItems } from "@/lib/client/media";
import { useModels } from "@/lib/client/useModels";
import { useStoredJson } from "@/lib/client/useStored";
import type { AspectRatio, MediaKind } from "@/lib/types";
import { useApp, type ModelChoice } from "../AppState";
import { findModel, ModelPicker } from "../ModelPicker";
import { MediaCard } from "./MediaCard";
import { OrbitArt, PageHeading } from "../Design";

const COPY: Record<MediaKind, { title: string; subtitle: string; placeholder: string; ideas: string[] }> = {
  image: {
    title: "Генерация изображений",
    subtitle: "GPT Image, Nano Banana, Imagen, FLUX, Ideogram и другие модели в одном месте.",
    placeholder: "Опишите изображение: что на нём, стиль, освещение, ракурс…",
    ideas: [
      "Уютная кофейня в дождливом Петербурге, вечер, тёплый свет, фотореализм",
      "Логотип для AI-стартапа «Nexus»: минимализм, фиолетовый градиент",
      "Космонавт верхом на лошади на Марсе, кинематографичный кадр, 35 мм",
      "Акварельная иллюстрация лисы в осеннем лесу",
    ],
  },
  video: {
    title: "Генерация видео",
    subtitle: "Veo, Kling, Seedance, Hailuo, Wan. Видео создаётся 1–5 минут — можно уйти со страницы, результат сохранится.",
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

export function MediaStudio({ kind }: { kind: MediaKind }) {
  const { me } = useApp();
  const copy = COPY[kind];
  const { data, loading } = useModels(kind);
  const models = useMemo(() => data?.models ?? [], [data]);
  const items = useMediaItems(kind);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>(RATIOS[kind][0]);
  const [saved, setSaved] = useStoredJson<ModelChoice>(`nexus:${kind}-model`);
  const [customModel, setCustomModel] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const replicateReady = data?.providers.some((p) => p.id === "replicate" && p.configured) ?? false;
  const noProviders = data !== null && models.length === 0 && !replicateReady;

  // The saved choice if it is still available, else the first featured model.
  const fallback = models.find((m) => m.featured) ?? models[0];
  const choice: ModelChoice | null =
    findModel(models, saved) || !fallback ? saved : { provider: fallback.provider, model: fallback.id };

  const custom = customModel.trim();
  const target: ModelChoice | null = custom ? { provider: "replicate", model: custom } : choice;
  const canGenerate = Boolean(target && prompt.trim());

  // Each click queues a job; its card in the gallery shows the progress.
  const submit = () => {
    if (!target || !prompt.trim()) return;
    void generate({ kind, ...target, prompt: prompt.trim(), aspectRatio: ratio });
  };

  const labelOf = (provider: string, id: string) =>
    models.find((m) => m.provider === provider && m.id === id)?.label ?? id;

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-content">
        <PageHeading number={kind === "image" ? "02" : "03"} eyebrow="Творческая студия" title={copy.title} description={copy.subtitle} />
        <div className={`studio-hero ${kind === "video" ? "studio-hero-video" : ""}`}>
          <div>
            <div className="mb-4 flex items-center gap-2 text-[11px] text-violet-200">
              {kind === "image" ? <ImageIcon className="size-4" /> : <Clapperboard className="size-4" />}
              {kind === "image" ? "Воображение становится видимым" : "У каждой идеи есть движение"}
            </div>
            <h2 className="text-[26px] font-medium leading-tight tracking-[-0.04em] text-zinc-100">
              {kind === "image" ? <>От нескольких слов<br />до целого мира.</> : <>Ваш замысел.<br />Следующий кадр.</>}
            </h2>
            <p className="mt-3 text-xs leading-6 text-zinc-400">Опишите то, что представляете. Остальное — дело ИИ.</p>
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
          <div className="composer-panel mt-6 rounded-3xl border p-4 md:p-5">
            <div className="section-label mb-3 px-2">Опишите вашу идею</div>
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              rows={3}
              placeholder={copy.placeholder}
              aria-label={copy.placeholder}
              className="w-full resize-none bg-transparent px-2 py-1 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
              <div className={custom ? "pointer-events-none opacity-40" : ""}>
                <ModelPicker models={models} value={choice} onChange={setSaved} loading={loading} />
              </div>

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

              {replicateReady && (
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
                className="nexus-button flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
              >
                <WandSparkles className="size-4" />
                Сгенерировать
              </button>
            </div>
          </div>
        )}

        {!noProviders && !prompt && (
          <div className="mt-3 flex flex-wrap gap-2">
            {copy.ideas.map((idea) => (
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
                  promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  promptRef.current?.focus();
                }}
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
