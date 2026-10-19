"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Clapperboard,
  Download,
  Image as ImageIcon,
  Layers3 as Layers,
  LoaderCircle,
  Play,
  RotateCcw,
  Trash2,
  TriangleAlert,
  WandSparkles,
  X,
} from "@/components/MaryxIcons";
import { CAMERA_MOTIONS, VIDEO_EFFECTS } from "@/lib/effects";
import { frameNow, frameOf, type Frame } from "@/lib/client/frames";
import type { MediaItem } from "@/lib/types";

type Filter = "all" | "ready" | "working";

const RATIO_CLASS: Record<MediaItem["aspectRatio"], string> = {
  "1:1": "aspect-square",
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "4:3": "aspect-[4/3]",
  "3:4": "aspect-[3/4]",
};

/** "1:07" since the clip was asked for. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</>;
}

/** What it was filmed with, as short tags. */
function tagsOf(item: MediaItem): string[] {
  return [
    VIDEO_EFFECTS.find((e) => e.id === item.effect)?.label,
    CAMERA_MOTIONS.find((m) => m.id === item.camera)?.label,
    item.inputs?.length === 2 ? "Переход" : item.inputs?.length ? "Из фото" : undefined,
    item.duration ? `${item.duration} с` : undefined,
  ].filter((t): t is string => Boolean(t));
}

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

const fileName = (item: MediaItem) => `maryx-${item.id.slice(0, 8)}.${item.files[0]?.mime.split("/")[1]?.split(";")[0] ?? "mp4"}`;

/** One clip in the grid: plays on hover (on phones, a tap opens it). */
function VideoTile({ item, onOpen, onReuse, onDelete }: { item: MediaItem; onOpen: () => void; onReuse: () => void; onDelete: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const url = item.files[0]?.url;
  const tags = tagsOf(item);
  return (
    <article className="video-tile" data-status={item.status}>
      <div className={`video-tile-media ${RATIO_CLASS[item.aspectRatio]}`}>
        {item.status === "succeeded" && url ? (
          <button
            type="button"
            className="video-tile-open"
            onClick={onOpen}
            onPointerEnter={() => void video.current?.play().catch(() => {})}
            onPointerLeave={() => {
              const v = video.current;
              if (!v) return;
              v.pause();
              v.currentTime = 0;
            }}
            aria-label={`Смотреть: ${item.prompt}`}
          >
            <video ref={video} src={url} muted loop playsInline preload="metadata" />
            <span className="video-tile-play" aria-hidden="true">
              <Play size={18} />
            </span>
          </button>
        ) : item.status === "pending" ? (
          <div className="video-tile-progress">
            <span className="video-tile-shimmer" aria-hidden="true" />
            <LoaderCircle className="size-6 animate-spin text-violet-200" />
            <strong>{item.progress !== undefined ? `${item.progress}%` : "MARYX снимает…"}</strong>
            <small>
              <Elapsed since={item.createdAt} /> · обычно 1–5 минут
            </small>
          </div>
        ) : (
          <div className="video-tile-failed">
            <TriangleAlert size={22} />
            <span className="line-clamp-4" title={item.error}>
              {item.error ?? "Не получилось снять видео."}
            </span>
            {item.errorCode === "limit" ? (
              <Link href="/pricing">Тарифы и кредиты →</Link>
            ) : (
              <button type="button" onClick={onReuse}>
                Попробовать снова
              </button>
            )}
          </div>
        )}
        {item.inputs?.[0] && (
          // eslint-disable-next-line @next/next/no-img-element -- a stored file or a local data URL
          <img className="video-tile-source" src={item.inputs[0].url} alt="Исходное фото" title="Исходное фото" />
        )}
      </div>
      <div className="video-tile-meta">
        <p title={item.prompt}>{item.prompt}</p>
        <div className="video-tile-row">
          <span className="video-tile-tags">
            {tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </span>
          {url && (
            <button type="button" onClick={() => download(url, fileName(item))} title="Скачать" aria-label="Скачать">
              <Download size={15} />
            </button>
          )}
          <button type="button" onClick={onReuse} title="Повторить с теми же настройками" aria-label="Повторить">
            <RotateCcw size={15} />
          </button>
          <button type="button" onClick={onDelete} title="Удалить" aria-label="Удалить" className="video-tile-delete">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}

/** A finished clip, big: watch it, continue it, take a still from it. */
function VideoPlayer({
  item,
  onClose,
  onReuse,
  onContinue,
  onFrame,
  onDelete,
}: {
  item: MediaItem;
  onClose: () => void;
  onReuse: () => void;
  onContinue: (frame: Frame) => void;
  onFrame: (frame: Frame, to: "video" | "image") => void;
  onDelete: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const url = item.files[0]?.url;
  const [still, setStill] = useState<Frame | null>(null);
  const [busy, setBusy] = useState<"continue" | "frame" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const continueIt = async () => {
    if (!url) return;
    setBusy("continue");
    setError(null);
    try {
      onContinue(await frameOf(url, "end"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const takeStill = async () => {
    const v = video.current;
    if (!v) return;
    v.pause();
    setBusy("frame");
    setError(null);
    try {
      setStill(await frameNow(v));
    } catch {
      setError("Не удалось взять кадр — дождитесь, пока видео загрузится.");
    }
    setBusy(null);
  };

  return (
    <div className="vs-dialog-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Видео" className="video-player" onClick={(e) => e.stopPropagation()}>
        <div className={`video-player-stage ${item.aspectRatio === "9:16" ? "is-tall" : ""}`}>
          {url && <video ref={video} src={url} controls autoPlay loop playsInline aria-label={`Видео: ${item.prompt}`} />}
        </div>
        <aside className="video-player-side">
          <div className="video-player-head">
            <span className="video-player-kicker">
              <Clapperboard size={14} /> Ваше видео
            </span>
            <button type="button" onClick={onClose} className="vs-icon-button" aria-label="Закрыть">
              <X size={18} />
            </button>
          </div>
          <p className="video-player-prompt">{item.prompt}</p>
          <div className="video-tile-tags">
            {tagsOf(item).map((t) => (
              <span key={t}>{t}</span>
            ))}
            <span>{item.aspectRatio}</span>
          </div>

          <div className="video-player-actions">
            <button type="button" onClick={() => void continueIt()} disabled={busy !== null} className="maryx-button">
              {busy === "continue" ? <LoaderCircle className="size-4 animate-spin" /> : <Layers size={16} />}
              Продолжить видео
            </button>
            <button type="button" onClick={() => void takeStill()} disabled={busy !== null}>
              {busy === "frame" ? <LoaderCircle className="size-4 animate-spin" /> : <Camera size={16} />}
              Кадр в фото
            </button>
            <button type="button" onClick={onReuse}>
              <RotateCcw size={16} /> Повторить
            </button>
            {url && (
              <button type="button" onClick={() => download(url, fileName(item))}>
                <Download size={16} /> Скачать
              </button>
            )}
            <button type="button" onClick={onDelete} className="video-player-delete">
              <Trash2 size={16} /> Удалить
            </button>
          </div>
          <p className="video-player-hint">
            «Продолжить» снимет следующую сцену с последнего кадра. «Кадр в фото» берёт кадр, на котором видео сейчас на паузе.
          </p>

          {still && (
            <div className="video-player-still">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
              <img src={`data:${still.mime};base64,${still.data}`} alt="Кадр из видео" />
              <div>
                <button type="button" onClick={() => onFrame(still, "video")}>
                  <WandSparkles size={15} /> Новое видео с этого кадра
                </button>
                <button type="button" onClick={() => onFrame(still, "image")}>
                  <ImageIcon size={15} /> Изменить в студии картинок
                </button>
                <button type="button" onClick={() => download(`data:${still.mime};base64,${still.data}`, `maryx-frame-${item.id.slice(0, 8)}.jpg`)}>
                  <Download size={15} /> Скачать кадр
                </button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="vs-error">
              {error}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

/** «Мои видео»: the clips, newest first, with the ones being filmed on top. */
export function VideoGallery({
  items,
  onReuse,
  onContinue,
  onFrame,
  onDelete,
}: {
  items: MediaItem[];
  onReuse: (item: MediaItem) => void;
  onContinue: (frame: Frame, item: MediaItem) => void;
  onFrame: (frame: Frame, to: "video" | "image") => void;
  onDelete: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const working = items.filter((i) => i.status === "pending").length;
  const shown = items.filter((i) => filter === "all" || (filter === "ready" ? i.status === "succeeded" : i.status === "pending"));
  const playing = items.find((i) => i.id === open && i.status === "succeeded");
  const close = () => setOpen(null);

  return (
    <section className="vs-gallery" aria-label="Мои видео">
      <div className="vs-gallery-head">
        <h2>
          Мои видео <span>{items.length}</span>
        </h2>
        <div role="radiogroup" aria-label="Показать" className="vs-segment">
          <button type="button" role="radio" aria-checked={filter === "all"} onClick={() => setFilter("all")}>
            Все
          </button>
          <button type="button" role="radio" aria-checked={filter === "ready"} onClick={() => setFilter("ready")}>
            Готовые
          </button>
          <button type="button" role="radio" aria-checked={filter === "working"} onClick={() => setFilter("working")}>
            В работе{working ? ` · ${working}` : ""}
          </button>
        </div>
      </div>
      {shown.length ? (
        <div className="vs-grid">
          {shown.map((item) => (
            <VideoTile key={item.id} item={item} onOpen={() => setOpen(item.id)} onReuse={() => onReuse(item)} onDelete={() => onDelete(item.id)} />
          ))}
        </div>
      ) : (
        <div className="vs-empty">
          <span className="vs-empty-reel" aria-hidden="true">
            <Clapperboard size={22} />
          </span>
          <h3>{items.length ? "Здесь пока пусто" : "Ваша киноплёнка начинается здесь"}</h3>
          <p>{items.length ? "Выберите другой фильтр." : "Опишите сцену или загрузите фото слева — готовые видео появятся здесь и будут играть при наведении."}</p>
        </div>
      )}
      {playing && (
        <VideoPlayer
          item={playing}
          onClose={close}
          onReuse={() => {
            close();
            onReuse(playing);
          }}
          onContinue={(frame) => {
            close();
            onContinue(frame, playing);
          }}
          onFrame={(frame, to) => {
            close();
            onFrame(frame, to);
          }}
          onDelete={() => {
            close();
            onDelete(playing.id);
          }}
        />
      )}
    </section>
  );
}
