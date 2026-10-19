"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Recast,
  Check,
  Clapperboard,
  Download,
  Film,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  X,
} from "@/components/MaryxIcons";
import { api } from "@/lib/client/api";
import { useCharacters } from "@/lib/client/characters";
import type { Frame } from "@/lib/client/frames";
import { generateItem, useMediaItems, whenDone } from "@/lib/client/media";
import { clipSeconds, findScenes, MAX_SCENES, renderTrend, type Segment, type TrendScene } from "@/lib/client/trend";
import { uploadVideo } from "@/lib/client/upload";
import { useModels } from "@/lib/client/useModels";
import { imageToAttachment, nearestRatio } from "@/lib/client/util";
import type { AspectRatio, MediaItem, ModelInfo } from "@/lib/types";
import { useApp } from "../AppState";
import { PresetArt } from "./PresetArt";

/** The biggest trend the browser cuts (it's never uploaded whole). */
const MAX_TREND_MB = 200;
const FRAME_RATIOS: AspectRatio[] = ["9:16", "16:9", "1:1", "3:4", "4:3"];
const CLIP_RATIOS: AspectRatio[] = ["9:16", "16:9"];

/** One of the trend's people, as MARYX found them, with a frame they're in. */
interface Person {
  id: number;
  who: string;
  whoEn: string;
  frame: Frame;
}

/** Whom a person of the trend becomes: as in the original, a saved character, or a photo. */
type Role = { kind: "original" } | { kind: "character"; id: string } | { kind: "photo"; photo: Frame };

interface Scene extends TrendScene {
  title: string;
  action: string;
  prompt: string;
  /** Who of the trend's people is in it, the main one first. */
  people: number[];
  /** The user's own words for this scene (added to MARYX's). */
  extra: string;
  on: boolean;
  /** Where it is on the way: the characters put in the frame, then the clip. */
  step: "idle" | "frame" | "clip" | "failed";
  error?: string;
  picture?: string;
  clip?: string;
}

/** The one-click run, step by step. */
type Stage = "idle" | "reading" | "framing" | "filming" | "gluing" | "saving" | "done";

const STAGES: { id: Stage; label: string }[] = [
  { id: "framing", label: "Ставлю героев в кадры" },
  { id: "filming", label: "Снимаю сцены" },
  { id: "gluing", label: "Склеиваю под музыку" },
  { id: "saving", label: "Сохраняю в «Мои видео»" },
];

/** "0:03" */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const plural = (n: number, [one, few, many]: [string, string, string]) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;

const choose = (models: ModelInfo[]) => {
  const m = models.find((x) => x.featured && x.photoEdit) ?? models.find((x) => x.photoEdit) ?? models[0];
  return m ? { provider: m.provider, model: m.id } : null;
};

async function frameAt(url: string): Promise<Frame> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Не удалось загрузить кадр");
  return imageToAttachment(await res.blob());
}

const src = (f: Frame) => `data:${f.mime};base64,${f.data}`;

/**
 * «Тренд» (like Higgsfield's Recast), in one click: someone's trending video
 * is cut into its scenes, MARYX finds its people and reads each scene, the
 * user says who becomes whom, and one button frames every scene with the
 * new people, films it, glues the scenes in time with the original music
 * (scenes nobody was changed in stay as they were) and saves the reel.
 */
export function TrendStudio() {
  const { me, refreshMe } = useApp();
  const characters = useCharacters();
  const images = useModels("image").data?.models ?? [];
  const videos = useModels("video").data?.models ?? [];
  const clips = useMediaItems("video");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [style, setStyle] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [cast, setCast] = useState<Record<number, Role>>({});
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [reel, setReel] = useState<{ url: string; ext: string; saved: boolean } | null>(null);
  const trendInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoFor = useRef<number>(0);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  useEffect(() => () => {
    if (reel) URL.revokeObjectURL(reel.url);
  }, [reel]);

  const imageTarget = choose(images);
  const videoTarget = choose(videos);
  const running = stage !== "idle" && stage !== "done";
  const roleOf = (id: number): Role => cast[id] ?? { kind: "original" };
  const changed = (id: number) => roleOf(id).kind !== "original";
  // The scenes to make anew: those with someone in them the user is changing.
  const toMake = scenes.filter((s) => s.on && s.people.some(changed));
  const anyCast = people.some((p) => changed(p.id));
  const canMake = Boolean(me && file && scenes.length && toMake.length && consent && !running && imageTarget && videoTarget);

  const update = (i: number, change: Partial<Scene>) => setScenes((list) => list.map((s, j) => (j === i ? { ...s, ...change } : s)));

  /** Who a person becomes; the scenes they're in are made anew. */
  const castAs = (id: number, role: Role) => {
    setCast((c) => ({ ...c, [id]: role }));
    setScenes((list) => list.map((s) => (s.people.includes(id) ? { ...s, picture: undefined, clip: undefined, step: "idle", error: undefined } : s)));
  };

  /** Cuts the trend into scenes (here, in the browser) and has MARYX find its people and read each scene. */
  const read = async (f: File) => {
    setStage("reading");
    setError(null);
    try {
      const { scenes: cut } = await findScenes(f);
      const got = await api<{
        style: string;
        people: { id: number; who: string; whoEn: string }[];
        shots: { title: string; action: string; prompt: string; people: number[] }[];
      }>("/api/trends/analyze", {
        method: "POST",
        body: JSON.stringify({ shots: cut.map((s) => ({ seconds: s.end - s.start, frame: { mime: s.frame.mime, data: s.frame.data } })) }),
      });
      const read = cut.map((s, i) => ({ ...s, ...got.shots[i], extra: "", on: true, step: "idle" as const }));
      setStyle(got.style);
      setScenes(read);
      setPeople(
        got.people.flatMap((p) => {
          const first = read.find((s) => s.people.includes(p.id));
          return first ? [{ ...p, frame: first.frame }] : [];
        }),
      );
      refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setStage("idle");
  };

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
    setPeople([]);
    setCast({});
    setStyle("");
    setReel(null);
    setNotes([]);
    // Straight away: whoever opens the page shouldn't have to know there's a next button.
    if (me) void read(f);
  };

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      castAs(photoFor.current, { kind: "photo", photo: await imageToAttachment(f) });
    } catch {
      setError(`Не удалось прочитать «${f.name}» — сохраните его как JPEG или PNG.`);
    }
  };

  /** The scene's frame with the new people in it: the picture's address. */
  const frame = async (i: number, scene: Scene): Promise<string> => {
    if (!imageTarget) throw new Error("Картинки сейчас недоступны.");
    const roles = scene.people.filter(changed).map((id) => ({ person: people.find((p) => p.id === id)!, role: roleOf(id) }));
    const framed = await generateItem({
      kind: "image",
      ...imageTarget,
      prompt: scene.extra.trim(),
      aspectRatio: nearestRatio(scene.frame.width, scene.frame.height, FRAME_RATIOS),
      images: [
        { mime: scene.frame.mime, data: scene.frame.data! },
        ...roles.flatMap(({ role }) => (role.kind === "photo" ? [{ mime: role.photo.mime, data: role.photo.data! }] : [])),
      ],
      cast: roles.map(({ person, role }) => ({ who: person.whoEn, ...(role.kind === "character" ? { character: role.id } : {}) })),
      recast: true,
      consent: true,
    });
    const done = framed.status === "pending" ? await whenDone(framed.id) : framed;
    if (done.status !== "succeeded" || !done.files[0]) throw new Error(done.error ?? "Не получилось поставить героев в кадр.");
    update(i, { picture: done.files[0].url, step: "clip" });
    return done.files[0].url;
  };

  /** One scene: the new people into its frame (unless they're there already), then that frame to life. Its clip's id. */
  const shoot = async (i: number, scene: Scene): Promise<string | null> => {
    if (!videoTarget) return null;
    let pictureUrl = scene.picture;
    update(i, { step: pictureUrl ? "clip" : "frame", error: undefined, clip: undefined });
    try {
      if (!pictureUrl) pictureUrl = await frame(i, scene);
      const picture = await frameAt(pictureUrl);
      const clip = await generateItem({
        kind: "video",
        ...videoTarget,
        prompt: [scene.prompt, scene.extra.trim()].filter(Boolean).join(". "),
        aspectRatio: nearestRatio(picture.width, picture.height, CLIP_RATIOS),
        images: [{ mime: picture.mime, data: picture.data! }],
        duration: clipSeconds(scene),
      });
      update(i, { clip: clip.id });
      return clip.id;
    } catch (e) {
      update(i, { step: "failed", error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };

  /**
   * The one button: every scene with someone changed is framed and filmed,
   * then all scenes are glued with the music (failed or unchanged ones as in
   * the original) and the reel is saved to «Мои видео».
   */
  const make = async (fresh = false) => {
    if (!canMake || !file || !preview) return;
    // «Переснять всё»: new takes of every scene; otherwise the ones already made are kept.
    const take = fresh ? scenes.map((s) => ({ ...s, picture: undefined, clip: undefined, step: "idle" as const, error: undefined })) : scenes;
    if (fresh) setScenes(take);
    setError(null);
    setNotes([]);
    setReel(null);
    setProgress(0);
    setStage("framing");
    // One frame after another (seconds each); each clip then films in the background.
    const started: { i: number; clip: Promise<string | null> }[] = [];
    for (const [i, scene] of take.entries()) {
      if (!scene.on || !scene.people.some(changed)) continue;
      const clip = scene.clip && clips.find((c) => c.id === scene.clip)?.status === "succeeded" ? Promise.resolve(scene.clip) : shoot(i, scene);
      started.push({ i, clip });
      await clip;
    }
    setStage("filming");
    const made = new Map<number, MediaItem>();
    const problems: string[] = [];
    await Promise.all(
      started.map(async ({ i, clip }) => {
        const id = await clip;
        const item = id ? await whenDone(id).catch(() => null) : null;
        if (item?.status === "succeeded" && item.files[0]) made.set(i, item);
        else problems.push(`Сцена ${i + 1} осталась как в оригинале${item?.error ? `: ${item.error}` : ""}.`);
      }),
    );
    if (!made.size) {
      setError("Ни одна сцена не получилась. Попробуйте ещё раз или выберите другое фото.");
      setNotes(problems);
      setStage("idle");
      return;
    }

    setStage("gluing");
    try {
      // Every scene in its place, as long as in the original: so the reel keeps time with the music.
      const segments: Segment[] = scenes.map((s, i) => {
        const item = made.get(i);
        return item ? { src: item.files[0].url, from: 0, seconds: s.end - s.start } : { src: preview, from: s.start, seconds: s.end - s.start };
      });
      const { blob, ext } = await renderTrend(segments, file, setProgress, { width: scenes[0].frame.width, height: scenes[0].frame.height });
      const url = URL.createObjectURL(blob);
      setReel({ url, ext, saved: false });
      setStage("saving");
      try {
        const upload = new File([blob], `maryx-trend.${ext}`, { type: blob.type });
        const { key } = await uploadVideo(upload, () => {});
        const { width, height } = scenes[0].frame;
        await api<MediaItem>("/api/media/import", {
          method: "POST",
          body: JSON.stringify({ key, prompt: `Тренд${style ? `: ${style}` : ""}`, aspectRatio: nearestRatio(width, height, CLIP_RATIOS), duration: scenes[scenes.length - 1].end }),
        });
        setReel({ url, ext, saved: true });
      } catch (e) {
        problems.push(`Ролик готов, но не сохранился в «Мои видео»: ${e instanceof Error ? e.message : String(e)} Скачайте его.`);
      }
      setNotes(problems);
      setStage("done");
      refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNotes(problems);
      setStage("idle");
    }
  };

  const clipOf = (s: Scene): MediaItem | undefined => (s.clip ? clips.find((c) => c.id === s.clip) : undefined);
  const framedCount = toMake.filter((s) => s.picture || s.step === "failed").length;
  const filmedCount = toMake.filter((s) => clipOf(s)?.status === "succeeded" || clipOf(s)?.status === "failed" || s.step === "failed").length;
  const stageIndex = STAGES.findIndex((s) => s.id === stage);

  return (
    <div className="video-studio">
      <div className="vs-panel composer-panel" aria-label="Повторить тренд">
        <div className="trend-step">
          <div className="trend-step-head">
            <span>1</span> Трендовое видео
          </div>
          {preview ? (
            <div className="trend-source">
              <video src={preview} muted loop autoPlay playsInline controls aria-label="Трендовое видео" />
              <button type="button" onClick={() => trendInput.current?.click()} disabled={running} className="vs-icon-button" aria-label="Заменить видео" title="Заменить">
                <RotateCcw size={16} />
              </button>
            </div>
          ) : (
            <button type="button" className="trend-drop" onClick={() => trendInput.current?.click()}>
              <Film size={26} />
              <strong>Загрузить тренд</strong>
              <small>Видео из TikTok, Reels или Shorts — MARYX сам найдёт в нём героев и сцены</small>
            </button>
          )}
          <input
            ref={trendInput}
            type="file"
            accept="video/*,.mov,.mp4,.webm"
            hidden
            onChange={(e) => {
              pickTrend(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {stage === "reading" && (
            <p className="trend-hint">
              <LoaderCircle className="mr-1 inline size-3.5 animate-spin" /> MARYX смотрит видео: ищет героев и сцены…
            </p>
          )}
          {file && !scenes.length && stage === "idle" && (
            <button type="button" className="trend-retry" onClick={() => void read(file)}>
              <Sparkles size={14} /> Разобрать видео
            </button>
          )}
        </div>

        {scenes.length > 0 && (
          <div className="trend-step">
            <div className="trend-step-head">
              <span>2</span> Кто кого играет
            </div>
            {!people.length && <p className="trend-hint">MARYX не нашёл в этом видео людей, которых можно заменить.</p>}
            {people.map((p) => {
              const role = roleOf(p.id);
              const inScenes = scenes.flatMap((s, i) => (s.people.includes(p.id) ? [i + 1] : []));
              return (
                <div key={p.id} className="trend-role">
                  <div className="trend-role-who">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
                    <img src={src(p.frame)} alt="" />
                    <div>
                      <strong>Герой {p.id}</strong>
                      <span>{p.who}</span>
                      <small>
                        {inScenes.length === 1 ? "сцена" : "сцены"} {inScenes.join(", ")}
                      </small>
                    </div>
                  </div>
                  <div role="group" aria-label={`Кем будет герой ${p.id}`} className="trend-cast">
                    <button type="button" aria-pressed={role.kind === "original"} onClick={() => castAs(p.id, { kind: "original" })} disabled={running}>
                      <span className="trend-cast-plus">
                        <X size={16} />
                      </span>
                      <span>Как было</span>
                    </button>
                    {(characters ?? []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={role.kind === "character" && role.id === c.id}
                        onClick={() => castAs(p.id, { kind: "character", id: c.id })}
                        disabled={running}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- the user's stored photo */}
                        <img src={c.photos[0]?.url} alt="" />
                        <span>{c.name}</span>
                      </button>
                    ))}
                    {role.kind === "photo" ? (
                      <button type="button" aria-pressed="true" disabled={running} onClick={() => castAs(p.id, { kind: "original" })} title="Убрать фото">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
                        <img src={src(role.photo)} alt={`Фото для героя ${p.id}`} />
                        <span>Фото</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="trend-cast-add"
                        disabled={running}
                        onClick={() => {
                          photoFor.current = p.id;
                          photoInput.current?.click();
                        }}
                      >
                        <span className="trend-cast-plus">
                          <ImagePlus size={18} />
                        </span>
                        <span>Своё фото</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {characters && characters.length === 0 && people.length > 0 && (
              <p className="trend-hint">
                Персонажа можно сохранить один раз в{" "}
                <Link href="/images" className="underline">
                  студии картинок
                </Link>{" "}
                («Персонаж для фотосессии») или просто загрузить фото.
              </p>
            )}
            <input
              ref={photoInput}
              type="file"
              accept="image/*,.heic,.heif"
              hidden
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {anyCast && (
              <label className="trend-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={running} />
                <span>На фото — я или люди, которые разрешили использовать своё лицо. Фото детей не загружаю.</span>
              </label>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="vs-error">
            {error}
          </p>
        )}
        {scenes.length > 0 && (
          <>
            <button type="button" onClick={() => void make()} disabled={!canMake} className="maryx-button vs-go">
              {running ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles size={17} />}
              {running ? "Делаю тренд…" : "Сделать мой тренд"}
            </button>
            <p className="vs-cost">
              {toMake.length
                ? `${toMake.length} ${plural(toMake.length, ["сцена", "сцены", "сцен"])} с новыми героями: ${toMake.length} ${plural(toMake.length, ["картинка", "картинки", "картинок"])} и ${toMake.length} видео из лимита. Остальные сцены — из оригинала.`
                : "Выберите, кем заменить героев. Сцены без замены останутся как в оригинале."}
            </p>
          </>
        )}
        {!scenes.length && <p className="vs-cost">Разбор — 1 сообщение. Видео тренда не загружается на сервер: MARYX видит только кадры сцен.</p>}
      </div>

      <div className="vs-results">
        {!scenes.length ? (
          <div className="trend-intro">
            <div className="trend-intro-visual" aria-hidden="true">
              <div>
                <PresetArt motion="orbit" />
                <span>Референс</span>
              </div>
              <span className="trend-intro-arrow">
                <ArrowRight size={23} />
              </span>
              <div>
                <PresetArt effect="aura" />
                <span>
                  <Recast size={13} />
                  Ваши герои
                </span>
              </div>
            </div>
            <span className="section-kicker">Знакомый сюжет. Новые главные роли.</span>
            <h2>
              Тот же тренд.
              <br />
              <span>Ваши герои.</span>
            </h2>
            <p className="trend-intro-lead">Загрузите ролик, скажите, кого кем заменить, — и нажмите одну кнопку. Остальное MARYX сделает сам.</p>
            <ol className="trend-process">
              <li>
                <span className="section-symbol">
                  <Film size={20} />
                </span>
                <div>
                  <strong>Загрузите тренд</strong>
                  <p>MARYX сам разрежет его на сцены (до {MAX_SCENES}) и найдёт всех героев — даже если их несколько.</p>
                </div>
              </li>
              <li>
                <span className="section-symbol">
                  <Recast size={20} />
                </span>
                <div>
                  <strong>Выберите, кто кого играет</strong>
                  <p>Каждому герою — ваш персонаж, фото или «как было».</p>
                </div>
              </li>
              <li>
                <span className="section-symbol">
                  <Clapperboard size={20} />
                </span>
                <div>
                  <strong>Одна кнопка — готовый ролик</strong>
                  <p>Сцены снимутся, склеятся под музыку оригинала и сохранятся в «Мои видео».</p>
                </div>
              </li>
            </ol>
          </div>
        ) : (
          <section className="trend-board" aria-label="Сцены тренда">
            {(running || stage === "done") && (
              <ol className="trend-progress" aria-label="Как идёт работа">
                {STAGES.map((s, i) => {
                  const state = stage === "done" || i < stageIndex ? "done" : i === stageIndex ? "now" : "next";
                  const detail =
                    s.id === "framing"
                      ? `${framedCount}/${toMake.length}`
                      : s.id === "filming"
                        ? `${filmedCount}/${toMake.length} · обычно 1–5 минут`
                        : s.id === "gluing" && state === "now"
                          ? `${Math.round(progress * 100)}%`
                          : "";
                  return (
                    <li key={s.id} data-state={state}>
                      <span className="trend-progress-mark">{state === "done" ? <Check size={13} /> : state === "now" ? <LoaderCircle className="size-3.5 animate-spin" /> : i + 1}</span>
                      <span>{s.label}</span>
                      {detail && <small>{detail}</small>}
                    </li>
                  );
                })}
              </ol>
            )}
            {running && <p className="trend-hint">Не закрывайте вкладку, пока ролик склеивается. Сцены снимаются на сервере и в любом случае появятся в «Мои видео».</p>}

            {reel && (
              <section className="trend-reel" aria-label="Готовый тренд">
                <div className={`trend-reel-stage ${scenes[0].frame.height > scenes[0].frame.width ? "is-tall" : ""}`}>
                  <video src={reel.url} controls autoPlay loop playsInline aria-label="Ваш тренд" />
                </div>
                <div className="trend-reel-actions">
                  <a href={reel.url} download={`maryx-trend.${reel.ext}`} className="maryx-button vs-reel-button">
                    <Download size={16} /> Скачать ролик
                  </a>
                  <button type="button" className="vs-reel-button" onClick={() => void make(true)} disabled={!canMake}>
                    <RotateCcw size={16} /> Переснять всё
                  </button>
                </div>
                {reel.saved && (
                  <p className="trend-hint">
                    <Check className="mr-1 inline size-3.5" /> Сохранено в «Мои видео».
                  </p>
                )}
              </section>
            )}
            {notes.length > 0 && (
              <ul className="trend-notes">
                {notes.map((n) => (
                  <li key={n}>
                    <TriangleAlert size={14} /> {n}
                  </li>
                ))}
              </ul>
            )}

            <details className="trend-details" open={!running && stage !== "done"}>
              <summary>
                Сцены <span>{scenes.length}</span>
                {style && <em>{style}</em>}
              </summary>
              <div className="trend-scenes">
                {scenes.map((s, i) => {
                  const clip = clipOf(s);
                  const failed = s.step === "failed" || clip?.status === "failed";
                  const recast = s.people.some(changed);
                  return (
                    <article key={i} className="trend-scene" data-state={failed ? "failed" : clip?.status === "succeeded" ? "ready" : s.step} data-off={!s.on || !recast || undefined}>
                      <div className="trend-scene-frames">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
                        <img src={src(s.frame)} alt={`Сцена ${i + 1} из тренда`} />
                        <ArrowRight size={16} aria-hidden="true" />
                        <div className="trend-scene-result">
                          {clip?.status === "succeeded" && clip.files[0] ? (
                            <video src={clip.files[0].url} muted loop autoPlay playsInline aria-label={`Сцена ${i + 1} с новыми героями`} />
                          ) : s.picture ? (
                            // eslint-disable-next-line @next/next/no-img-element -- a stored file
                            <img src={s.picture} alt={`Кадр ${i + 1} с новыми героями`} />
                          ) : (
                            <span className="trend-scene-wait">{recast && s.on ? <Clapperboard size={18} /> : <small>как в оригинале</small>}</span>
                          )}
                          {(s.step === "frame" || (s.step === "clip" && clip?.status !== "succeeded" && !failed)) && (
                            <span className="trend-scene-busy">
                              <LoaderCircle className="size-5 animate-spin" />
                              {s.step === "frame" ? "Герои в кадре…" : clip?.progress !== undefined ? `Видео ${clip.progress}%` : "Снимаю видео…"}
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
                        {s.people.length > 0 && (
                          <div className="trend-scene-people">
                            {s.people.map((id) => (
                              <span key={id} data-changed={changed(id) || undefined}>
                                Герой {id}
                              </span>
                            ))}
                          </div>
                        )}
                        <input
                          value={s.extra}
                          onChange={(e) => update(i, { extra: e.target.value })}
                          placeholder="Уточнить сцену (необязательно)"
                          aria-label={`Уточнить сцену ${i + 1}`}
                          maxLength={300}
                          disabled={running}
                        />
                        <div className="trend-scene-foot">
                          <label>
                            <input type="checkbox" checked={s.on} onChange={(e) => update(i, { on: e.target.checked })} disabled={running || !recast} />
                            Снимать заново
                          </label>
                          {clip?.status === "succeeded" && (
                            <span className="trend-scene-ready">
                              <Check size={13} />
                              Готово
                            </span>
                          )}
                          {failed && (
                            <span className="trend-scene-error" title={s.error ?? clip?.error}>
                              <TriangleAlert size={14} /> {s.error ?? clip?.error ?? "Не получилось"}
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </details>
            {!running && (
              <button
                type="button"
                className="trend-reset"
                onClick={() => {
                  setScenes([]);
                  setPeople([]);
                  setFile(null);
                  setPreview(null);
                  setReel(null);
                  setNotes([]);
                  setStage("idle");
                }}
              >
                <X size={14} /> Новый тренд
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
