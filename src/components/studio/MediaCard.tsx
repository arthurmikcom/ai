"use client";

import { Clapperboard, Columns2, Download, ImagePlus, LoaderCircle, RotateCcw, Trash2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { providerName } from "@/lib/catalog";
import { BeforeAfter } from "../BeforeAfter";
import type { MediaItem } from "@/lib/types";

const ASPECT_CLASS: Record<MediaItem["aspectRatio"], string> = {
  "1:1": "aspect-square",
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "4:3": "aspect-[4/3]",
  "3:4": "aspect-[3/4]",
};

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</>;
}

interface Props {
  item: MediaItem;
  modelLabel: string;
  onReuse: () => void;
  /** Edit this picture further (it becomes the photo to edit). */
  onEdit?: () => void;
  /** Bring this picture to life: it becomes a video's first frame. */
  onAnimate?: () => void;
  onDelete: () => void;
}

export function MediaCard({ item, modelLabel, onReuse, onEdit, onAnimate, onDelete }: Props) {
  const source = item.inputs?.[0];
  const file = item.files[0];
  const url = file?.url;
  const [zoom, setZoom] = useState(false);
  // An edited photo next to its source: drag to compare.
  const [compare, setCompare] = useState(false);
  const isVideo = file?.mime.startsWith("video/") ?? item.kind === "video";
  const ext = file?.mime.split("/")[1]?.split(";")[0] ?? (isVideo ? "mp4" : "png");

  return (
    <div className="surface-card group overflow-hidden rounded-2xl transition hover:border-violet-300/25">
      <div className={`relative ${ASPECT_CLASS[item.aspectRatio]} bg-black/40`}>
        {item.status === "pending" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 text-zinc-300">
            <LoaderCircle className="size-7 animate-spin text-violet-300" />
            <div className="text-sm">
              {item.progress !== undefined ? `${item.progress}%` : "Генерация…"}
            </div>
            <div className="text-xs text-zinc-500">
              <Elapsed since={item.createdAt} />
            </div>
          </div>
        )}
        {item.status === "failed" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-red-200">
            <TriangleAlert className="size-6" />
            <span className="line-clamp-6 break-words" title={item.error}>{item.error}</span>
            {item.errorCode === "limit" && (
              <Link href="/pricing" className="font-medium text-white underline">
                Тарифы и кредиты →
              </Link>
            )}
          </div>
        )}
        {item.status === "succeeded" && url && compare && source && !isVideo ? (
          <BeforeAfter before={source.url} after={url} fill className="absolute inset-0" />
        ) : item.status === "succeeded" && url &&
          (isVideo ? (
            <video src={url} controls loop playsInline className="absolute inset-0 size-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- local blob URL
            <img
              src={url}
              alt={item.prompt}
              onClick={() => setZoom(true)}
              className="absolute inset-0 size-full cursor-zoom-in object-cover"
            />
          ))}
        {source && !compare && (
          // eslint-disable-next-line @next/next/no-img-element -- stored file or local data URL
          <img
            src={source.url}
            alt="Исходное фото"
            title="Исходное фото"
            className="absolute bottom-2 left-2 size-10 rounded-lg border border-white/20 object-cover shadow-lg"
          />
        )}
      </div>

      <div className="space-y-3 p-4">
        <p className="line-clamp-2 text-sm text-zinc-300" title={item.prompt}>
          {item.prompt}
        </p>
        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-500" title={providerName(item.provider)}>
            {modelLabel}
          </span>
          {url && (
            <a
              href={url}
              download={`maryx-${item.id.slice(0, 8)}.${ext}`}
              title="Скачать"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            >
              <Download className="size-4" />
            </a>
          )}
          {onEdit && item.status === "succeeded" && url && !isVideo && (
            <button
              type="button"
              onClick={onEdit}
              title="Обработать это изображение ещё раз"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            >
              <ImagePlus className="size-4" />
            </button>
          )}
          {source && item.status === "succeeded" && url && !isVideo && (
            <button
              type="button"
              onClick={() => setCompare((c) => !c)}
              aria-pressed={compare}
              title={compare ? "Обычный вид" : "Сравнить до и после"}
              className={`rounded-lg p-1.5 hover:bg-white/5 hover:text-zinc-100 ${compare ? "text-violet-300" : "text-zinc-400"}`}
            >
              <Columns2 className="size-4" />
            </button>
          )}
          {onAnimate && item.status === "succeeded" && url && !isVideo && (
            <button
              type="button"
              onClick={onAnimate}
              title="Оживить: сделать из картинки видео"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            >
              <Clapperboard className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onReuse}
            title={item.inputs?.length ? "Повторить с этим фото и описанием" : "Использовать этот промпт"}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Удалить"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-red-300"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {zoom && url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoom(false)}
        >
          <button type="button" className="absolute right-4 top-4 text-zinc-300 hover:text-white">
            <X className="size-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
          <img src={url} alt={item.prompt} className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}
