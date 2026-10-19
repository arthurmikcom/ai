"use client";

import { Brush, Eraser, LoaderCircle, RotateCcw, WandSparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { imageToAttachment } from "@/lib/client/util";
import { BRUSH_IDEAS, BRUSH_PREFIX } from "@/lib/effects";
import type { Attachment } from "@/lib/types";

type Photo = Attachment & { width: number; height: number };

export interface BrushEdit {
  /** The picture as it is, then the same picture with the area to change painted red. */
  photos: [Photo, Photo];
  /** The ask, starting with BRUSH_PREFIX (the server knows a brush edit by it). */
  prompt: string;
}

const PAINT = "#ff1f4b";
/** How strongly the paint covers the picture on the marked copy. */
const MARK_ALPHA = 0.6;

/** Whether anything is painted (the eraser may have taken it all away). */
function hasPaint(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 16) if (data[i] > 0) return true;
  return false;
}

/**
 * The brush (generative fill): paint over the place to change, say what to
 * do there, and only that place changes. The model gets the picture and a
 * copy with the place painted red.
 */
export function BrushEditor({ src, onApply, onClose }: { src: string; onApply: (edit: BrushEdit) => void; onClose: () => void }) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The brush's width, in percent of the picture's longest side.
  const [size, setSize] = useState(6);
  const [erasing, setErasing] = useState(false);
  const [painted, setPainted] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then(imageToAttachment)
      .then(
        (p) => alive && setPhoto(p),
        () => alive && setError("Не удалось загрузить картинку — попробуйте ещё раз."),
      );
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    ctx.strokeStyle = PAINT;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(4, (Math.max(c.width, c.height) * size) / 100);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setPainted(false);
  };

  const apply = async () => {
    const c = canvas.current;
    if (!c || !photo || !image.current || busy) return;
    if (!hasPaint(c)) {
      setError("Закрасьте кистью место, которое нужно изменить.");
      return;
    }
    setBusy(true);
    try {
      const out = document.createElement("canvas");
      out.width = c.width;
      out.height = c.height;
      const ctx = out.getContext("2d")!;
      ctx.drawImage(image.current, 0, 0, out.width, out.height);
      ctx.globalAlpha = MARK_ALPHA;
      ctx.drawImage(c, 0, 0);
      const url = out.toDataURL("image/jpeg", 0.88);
      const marked: Photo = { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1), name: "Выделенное место", width: out.width, height: out.height };
      onApply({ photos: [photo, marked], prompt: `${BRUSH_PREFIX} ${prompt.trim()}` });
    } catch {
      setError("Не удалось подготовить картинку — попробуйте ещё раз.");
      setBusy(false);
    }
  };

  const ready = Boolean(photo && painted && prompt.trim() && !busy);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Кисть"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm md:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Brush className="size-4 text-violet-300" />
          <span className="text-sm font-medium text-zinc-100">Кисть</span>
          <span className="hidden text-xs text-zinc-500 sm:inline">Закрасьте место, которое нужно изменить, и напишите, что там сделать</span>
          <button type="button" onClick={onClose} aria-label="Закрыть кисть" className="ml-auto rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-40 items-center justify-center rounded-2xl bg-black/40">
          {photo ? (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
              <img
                ref={image}
                src={`data:${photo.mime};base64,${photo.data}`}
                alt="Картинка для правки"
                draggable={false}
                className="block max-h-[55vh] w-auto max-w-full select-none rounded-xl"
              />
              <canvas
                ref={canvas}
                width={photo.width}
                height={photo.height}
                aria-label="Холст для кисти: закрасьте место"
                className={`absolute inset-0 size-full touch-none rounded-xl opacity-55 ${erasing ? "cursor-cell" : "cursor-crosshair"}`}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const p = point(e);
                  last.current = p;
                  stroke(p, p);
                  if (!erasing) setPainted(true);
                  setError(null);
                }}
                onPointerMove={(e) => {
                  if (!last.current) return;
                  const p = point(e);
                  stroke(last.current, p);
                  last.current = p;
                }}
                onPointerUp={() => (last.current = null)}
                onPointerCancel={() => (last.current = null)}
              />
            </div>
          ) : error ? null : (
            <LoaderCircle className="size-6 animate-spin text-violet-300" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex rounded-xl bg-white/[0.04] p-0.5">
            <button
              type="button"
              aria-pressed={!erasing}
              onClick={() => setErasing(false)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 ${!erasing ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"}`}
            >
              <Brush className="size-3.5" /> Кисть
            </button>
            <button
              type="button"
              aria-pressed={erasing}
              onClick={() => setErasing(true)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 ${erasing ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"}`}
            >
              <Eraser className="size-3.5" /> Ластик
            </button>
          </div>
          <label className="flex items-center gap-2 text-zinc-400">
            Размер
            <input
              type="range"
              min={2}
              max={15}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              aria-label="Размер кисти"
              className="w-24 accent-violet-400"
            />
          </label>
          <button type="button" onClick={clear} className="flex items-center gap-1 rounded-lg px-2 py-1 text-zinc-400 hover:text-zinc-100">
            <RotateCcw className="size-3.5" /> Очистить
          </button>
        </div>

        <div role="group" aria-label="Что сделать" className="flex flex-wrap gap-1.5">
          {BRUSH_IDEAS.map((idea) => (
            <button
              key={idea.label}
              type="button"
              aria-pressed={prompt === idea.prompt}
              onClick={() => setPrompt(idea.prompt)}
              className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                prompt === idea.prompt
                  ? "border-violet-300/50 bg-violet-500/20 text-violet-100"
                  : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-violet-300/40 hover:text-zinc-50"
              }`}
            >
              <span aria-hidden="true">{idea.emoji}</span> {idea.label}
            </button>
          ))}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void apply();
          }}
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={1000}
            placeholder="Что сделать в закрашенном месте? Например: убери человека"
            aria-label="Что сделать в закрашенном месте"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-300/40"
          />
          <button type="submit" disabled={!ready} className="maryx-button flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm">
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}
            Изменить
          </button>
        </form>
        {!painted && photo && !error && <p className="text-xs text-zinc-500">Проведите по картинке пальцем или мышью — закрашенное место изменится, остальное останется как есть.</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
