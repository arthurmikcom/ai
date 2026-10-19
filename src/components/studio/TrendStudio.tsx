"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Clapperboard,
  Download,
  Film,
  ImagePlus,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  UserRound,
  WandSparkles,
  X,
} from "@/components/MaryxIcons";
import { api } from "@/lib/client/api";
import { useCharacters } from "@/lib/client/characters";
import type { Frame } from "@/lib/client/frames";
import { generateItem, useMediaItems, whenDone } from "@/lib/client/media";
import { clipSeconds, findScenes, MAX_SCENES, renderReel, type TrendScene } from "@/lib/client/trend";
import { useModels } from "@/lib/client/useModels";
import { imageToAttachment, nearestRatio } from "@/lib/client/util";
import type { AspectRatio, MediaItem, ModelInfo } from "@/lib/types";
import { useApp } from "../AppState";

/** The biggest trend the browser cuts (it's never uploaded whole). */
const MAX_TREND_MB = 200;
const FRAME_RATIOS: AspectRatio[] = ["9:16", "16:9", "1:1", "3:4", "4:3"];
const CLIP_RATIOS: AspectRatio[] = ["9:16", "16:9"];

interface Scene extends TrendScene {
  title: string;
  action: string;
  prompt: string;
  /** The user's own words for this scene (added to MARYX's). */
  extra: string;
  on: boolean;
  /** Where it is on the way: the character put in the frame, then the clip. */
  step: "idle" | "frame" | "clip" | "failed";
  error?: string;
  picture?: string;
  clip?: string;
}

/** "0:03" */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const choose = (models: ModelInfo[]) => {
  const m = models.find((x) => x.featured && x.photoEdit) ?? models.find((x) => x.photoEdit) ?? models[0];
  return m ? { provider: m.provider, model: m.id } : null;
};

async function frameAt(url: string): Promise<Frame> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Не удалось загрузить кадр");
  return imageToAttachment(await res.blob());
}

/** The finished scenes, one after another, with the trend's own music. */
function TrendReel({ clips, music, ratio }: { clips: string[]; music: File; ratio: AspectRatio }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const musicUrl = useMemo(() => URL.createObjectURL(music), [music]);
  useEffect(() => () => URL.revokeObjectURL(musicUrl), [musicUrl]);

  const start = () => {
    setIndex(0);
    setPlaying(true);
    if (audio.current) {
      audio.current.currentTime = 0;
      void audio.current.play().catch(() => {});
    }
  };
  const stop = () => {
    setPlaying(false);
    audio.current?.pause();
    video.current?.pause();
  };
  const next = () => {
    if (index + 1 < clips.length) setIndex(index + 1);
    else stop();
  };

  const download = async () => {
    setError(null);
    stop();
    setRendering(0);
    try {
      const { blob, ext } = await renderReel(clips, music, setRendering);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `maryx-trend.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setRendering(null);
  };

  return (
    <section className="trend-reel" aria-label="Готовый тренд">
      <div className={`trend-reel-stage ${ratio === "9:16" ? "is-tall" : ""}`}>
        <video
          ref={video}
          key={`${index}-${playing}`}
          src={clips[index]}
          autoPlay={playing}
          muted
          playsInline
          onEnded={next}
          aria-label="Тренд с вашим персонажем"
        />
        <audio ref={audio} src={musicUrl} preload="auto" />
        {!playing && (
          <button type="button" className="trend-reel-play" onClick={start} aria-label="Смотреть тренд">
            <Play size={26} />
          </button>
        )}
        <span className="trend-reel-count">
          {index + 1} / {clips.length}
        </span>
      </div>
      <div className="trend-reel-actions">
        <button type="button" onClick={playing ? stop : start} className="vs-reel-button">
          {playing ? <Pause size={16} /> : <Play size={16} />}
          {playing ? "Пауза" : "Смотреть с музыкой"}
        </button>
        <button type="button" onClick={() => void download()} disabled={rendering !== null} className="maryx-button vs-reel-button">
          {rendering !== null ? <LoaderCircle className="size-4 animate-spin" /> : <Download size={16} />}
          {rendering !== null ? `Собираю ролик… ${Math.round(rendering * 100)}%` : "Скачать ролик"}
        </button>
      </div>
      <p className="trend-hint">Ролик собирается прямо в браузере из готовых сцен и музыки оригинала — это занимает столько же времени, сколько он длится.</p>
      {error && (
        <p role="alert" className="vs-error">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * «Тренд» (like Higgsfield's Recast): someone's trending video is cut into
 * its scenes, MARYX reads what happens in each, the user's character takes
 * the main person's place in each scene's frame, each frame comes to life,
 * and the scenes play back with the original music.
 */
export function TrendStudio({ tabs }: { tabs: ReactNode }) {
  const { me } = useApp();
  const characters = useCharacters();
  const images = useModels("image").data?.models ?? [];
  const videos = useModels("video").data?.models ?? [];
  const clips = useMediaItems("video");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Frame | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"reading" | "shooting" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const trendInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const character = characters?.find((c) => c.id === characterId) ?? null;
  const who = character || photo;
  const imageTarget = choose(images);
  const videoTarget = choose(videos);
  const canRead = Boolean(me && file && who && consent && !busy);

  const update = (i: number, change: Partial<Scene>) => setScenes((list) => list.map((s, j) => (j === i ? { ...s, ...change } : s)));

  const pickTrend = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v)$/i.test(f.name)) {
      setError("Нужно видео: MP4, MOV или WebM.");
      return;
    }
    if (f.size > MAX_TREND_MB * 1024 * 1024) {
      setError(`Видео слишком большое: до ${MAX_TREND_MB} МБ.`);
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setScenes([]);
    setStyle("");
  };

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      setPhoto(await imageToAttachment(f));
      setCharacterId(null);
    } catch {
      setError(`Не удалось прочитать «${f.name}» — сохраните его как JPEG или PNG.`);
    }
  };

  /** Cuts the trend into scenes (here, in the browser) and has MARYX read them. */
  const read = async () => {
    if (!canRead || !file) return;
    setBusy("reading");
    setError(null);
    try {
      const { scenes: cut } = await findScenes(file);
      const got = await api<{ style: string; shots: { title: string; action: string; prompt: string }[] }>("/api/trends/analyze", {
        method: "POST",
        body: JSON.stringify({ shots: cut.map((s) => ({ seconds: s.end - s.start, frame: { mime: s.frame.mime, data: s.frame.data } })) }),
      });
      setStyle(got.style);
      setScenes(cut.map((s, i) => ({ ...s, ...got.shots[i], extra: "", on: true, step: "idle" })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  /** One scene: the character into its frame, then that frame to life. */
  const shoot = async (i: number, scene: Scene) => {
    if (!imageTarget || !videoTarget || !who) return;
    update(i, { step: "frame", error: undefined, picture: undefined, clip: undefined });
    try {
      const framed = await generateItem({
        kind: "image",
        ...imageTarget,
        prompt: scene.extra.trim(),
        aspectRatio: nearestRatio(scene.frame.width, scene.frame.height, FRAME_RATIOS),
        images: [{ mime: scene.frame.mime, data: scene.frame.data! }, ...(character ? [] : [{ mime: photo!.mime, data: photo!.data! }])],
        ...(character ? { character: character.id } : {}),
        recast: true,
        consent: true,
      });
      const done = framed.status === "pending" ? await whenDone(framed.id) : framed;
      if (done.status !== "succeeded" || !done.files[0]) throw new Error(done.error ?? "Не получилось поставить персонажа в кадр.");
      update(i, { picture: done.files[0].url, step: "clip" });
      const picture = await frameAt(done.files[0].url);
      const clip = await generateItem({
        kind: "video",
        ...videoTarget,
        prompt: [scene.prompt, scene.extra.trim()].filter(Boolean).join(". "),
        aspectRatio: nearestRatio(picture.width, picture.height, CLIP_RATIOS),
        images: [{ mime: picture.mime, data: picture.data! }],
        duration: clipSeconds(scene),
      });
      update(i, { clip: clip.id });
    } catch (e) {
      update(i, { step: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  };

  const shootAll = async () => {
    setBusy("shooting");
    setError(null);
    // One after another: each frame takes seconds, its clip then films in the background.
    for (const [i, scene] of scenes.entries()) if (scene.on) await shoot(i, scene);
    setBusy(null);
  };

  const clipOf = (s: Scene): MediaItem | undefined => (s.clip ? clips.find((c) => c.id === s.clip) : undefined);
  const chosen = scenes.filter((s) => s.on);
  const finished = chosen.map((s) => clipOf(s)).filter((c): c is MediaItem => c?.status === "succeeded" && Boolean(c.files[0]));
  const allDone = chosen.length > 0 && finished.length === chosen.length;
  const started = scenes.some((s) => s.step !== "idle");

  return (
    <div className="video-studio">
      <div className="vs-panel composer-panel" aria-label="Повторить тренд">
        {tabs}
        <div className="trend-step">
          <div className="trend-step-head">
            <span>1</span> Трендовое видео
          </div>
          {preview ? (
            <div className="trend-source">
              <video src={preview} muted loop autoPlay playsInline controls aria-label="Трендовое видео" />
              <button type="button" onClick={() => trendInput.current?.click()} className="vs-icon-button" aria-label="Заменить видео" title="Заменить">
                <RotateCcw size={16} />
              </button>
            </div>
          ) : (
            <button type="button" className="trend-drop" onClick={() => trendInput.current?.click()}>
              <Film size={26} />
              <strong>Загрузить тренд</strong>
              <small>Видео из TikTok, Reels или Shorts — MARYX разберёт его по сценам</small>
            </button>
          )}
          <input ref={trendInput} type="file" accept="video/*,.mov,.mp4,.webm" hidden onChange={(e) => {
            pickTrend(e.target.files?.[0]);
            e.target.value = "";
          }} />
        </div>

        <div className="trend-step">
          <div className="trend-step-head">
            <span>2</span> Кто в главной роли
          </div>
          <div role="group" aria-label="Персонаж" className="trend-cast">
            {(characters ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={characterId === c.id}
                onClick={() => {
                  setCharacterId(characterId === c.id ? null : c.id);
                  setPhoto(null);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- the user's stored photo */}
                <img src={c.photos[0]?.url} alt="" />
                <span>{c.name}</span>
              </button>
            ))}
            {photo ? (
              <button type="button" aria-pressed="true" onClick={() => setPhoto(null)} title="Убрать фото">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
                <img src={`data:${photo.mime};base64,${photo.data}`} alt="Фото для тренда" />
                <span>Фото</span>
              </button>
            ) : (
              <button type="button" onClick={() => photoInput.current?.click()} className="trend-cast-add">
                <span className="trend-cast-plus">
                  <ImagePlus size={18} />
                </span>
                <span>Своё фото</span>
              </button>
            )}
          </div>
          {characters && characters.length === 0 && (
            <p className="trend-hint">
              Персонажа можно сохранить один раз в{" "}
              <Link href="/images" className="underline">
                студии картинок
              </Link>{" "}
              («Персонаж для фотосессии») или просто загрузить фото.
            </p>
          )}
          <input ref={photoInput} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => {
            void pickPhoto(e.target.files?.[0]);
            e.target.value = "";
          }} />
          <label className="trend-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>На фото — я или человек, который разрешил использовать своё лицо. Фото детей не загружаю.</span>
          </label>
        </div>

        {error && (
          <p role="alert" className="vs-error">
            {error}
          </p>
        )}
        <button type="button" onClick={() => void read()} disabled={!canRead} className="maryx-button vs-go">
          {busy === "reading" ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles size={17} />}
          {busy === "reading" ? "Разбираю тренд…" : scenes.length ? "Разобрать заново" : "Разобрать тренд"}
        </button>
        <p className="vs-cost">Разбор — 1 сообщение. Каждая сцена — 1 картинка и 1 видео из лимита. Видео тренда не загружается на сервер.</p>
      </div>

      <div className="vs-results">
        {!scenes.length ? (
          <div className="trend-intro">
            <span className="vs-empty-reel" aria-hidden="true">
              <UserRound size={22} />
            </span>
            <h2>Повторите любой тренд со своим персонажем</h2>
            <ol>
              <li>Загрузите трендовое видео — MARYX разрежет его на сцены (до {MAX_SCENES}) и поймёт, что в каждой происходит.</li>
              <li>Выберите персонажа: он займёт место главного героя в каждом кадре.</li>
              <li>Каждая сцена оживёт, а готовый ролик соберётся с музыкой оригинала.</li>
            </ol>
          </div>
        ) : (
          <section className="trend-board" aria-label="Сцены тренда">
            <div className="vs-gallery-head">
              <h2>
                Раскадровка <span>{scenes.length} сц.</span>
              </h2>
              {style && <p className="trend-style">{style}</p>}
            </div>
            <div className="trend-scenes">
              {scenes.map((s, i) => {
                const clip = clipOf(s);
                const failed = s.step === "failed" || clip?.status === "failed";
                return (
                  <article key={i} className="trend-scene" data-off={!s.on || undefined}>
                    <div className="trend-scene-frames">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
                      <img src={`data:${s.frame.mime};base64,${s.frame.data}`} alt={`Сцена ${i + 1} из тренда`} />
                      <ArrowRight size={16} aria-hidden="true" />
                      <div className="trend-scene-result">
                        {clip?.status === "succeeded" && clip.files[0] ? (
                          <video src={clip.files[0].url} muted loop autoPlay playsInline aria-label={`Сцена ${i + 1} с персонажем`} />
                        ) : s.picture ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a stored file
                          <img src={s.picture} alt={`Кадр ${i + 1} с персонажем`} />
                        ) : (
                          <span className="trend-scene-wait">
                            <Clapperboard size={18} />
                          </span>
                        )}
                        {(s.step === "frame" || (s.step === "clip" && clip?.status !== "succeeded" && !failed)) && (
                          <span className="trend-scene-busy">
                            <LoaderCircle className="size-5 animate-spin" />
                            {s.step === "frame" ? "Персонаж в кадре…" : clip?.progress !== undefined ? `Видео ${clip.progress}%` : "Снимаю видео…"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="trend-scene-copy">
                      <div className="trend-scene-title">
                        <strong>
                          {i + 1}. {s.title}
                        </strong>
                        <span>
                          {clock(s.start)}–{clock(s.end)}
                        </span>
                      </div>
                      {s.action && <p>{s.action}</p>}
                      <input
                        value={s.extra}
                        onChange={(e) => update(i, { extra: e.target.value })}
                        placeholder="Уточнить сцену (необязательно)"
                        aria-label={`Уточнить сцену ${i + 1}`}
                        maxLength={300}
                        disabled={busy === "shooting"}
                      />
                      <div className="trend-scene-foot">
                        <label>
                          <input type="checkbox" checked={s.on} onChange={(e) => update(i, { on: e.target.checked })} disabled={busy === "shooting"} />
                          Снимать
                        </label>
                        {failed && (
                          <>
                            <span className="trend-scene-error" title={s.error ?? clip?.error}>
                              <TriangleAlert size={14} /> {s.error ?? clip?.error ?? "Не получилось"}
                            </span>
                            <button type="button" onClick={() => void shoot(i, s)} disabled={busy !== null}>
                              Ещё раз
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {!started && (
              <button type="button" onClick={() => void shootAll()} disabled={!chosen.length || busy !== null || !imageTarget || !videoTarget} className="maryx-button vs-go trend-shoot">
                <WandSparkles size={17} /> Снять тренд — {chosen.length} {chosen.length === 1 ? "сцена" : chosen.length < 5 ? "сцены" : "сцен"}
              </button>
            )}
            {started && !allDone && (
              <p className="trend-hint">
                <LoaderCircle className="mr-1 inline size-3.5 animate-spin" />
                Сцены снимаются 1–5 минут. Можно уйти со страницы: готовые видео появятся в «Мои видео».
              </p>
            )}
            {allDone && file && (
              <TrendReel
                clips={finished.map((c) => c.files[0].url)}
                music={file}
                ratio={finished[0].aspectRatio}
              />
            )}
            {started && (
              <button type="button" className="trend-reset" onClick={() => setScenes([])} disabled={busy !== null}>
                <X size={14} /> Новый тренд
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
