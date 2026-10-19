"use client";

// A still from a clip, taken right in the browser: the last frame continues a
// video («Продолжить»), the one on screen becomes a photo («Кадр в фото»).

import type { Attachment } from "@/lib/types";
import { imageToAttachment } from "./util";

export type Frame = Attachment & { width: number; height: number };

/** The image studio picks a still up here (a frame sent from the video studio). */
export const FRAME_KEY = "maryx:edit-photo";

function still(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.width) return Promise.reject(new Error("Кадр недоступен"));
  ctx.drawImage(video, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Кадр недоступен"))), "image/jpeg", 0.92));
}

/** The frame a playing (or paused) video shows now. */
export async function frameNow(video: HTMLVideoElement): Promise<Frame> {
  return imageToAttachment(await still(video));
}

/** A clip's last frame (or any `at` seconds in), loaded on the side. */
export function frameOf(url: string, at: "end" | number = "end"): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    const fail = () => reject(new Error("Не удалось взять кадр из видео — попробуйте другой браузер."));
    const timer = setTimeout(fail, 20_000);
    video.onerror = fail;
    video.onloadedmetadata = () => {
      const end = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = at === "end" ? Math.max(0, end - 0.08) : Math.min(at, end);
    };
    video.onseeked = () => {
      clearTimeout(timer);
      frameNow(video).then(resolve, reject);
    };
    video.src = url;
  });
}

/** Hands a still to the image studio, which opens with it as the photo to edit. */
export function sendToImageStudio(frame: Frame): boolean {
  try {
    sessionStorage.setItem(FRAME_KEY, JSON.stringify({ mime: frame.mime, data: frame.data }));
    return true;
  } catch {
    return false;
  }
}

/** The still sent from the video studio, if any. */
export function sentFrame(): { mime: string; data: string } | null {
  try {
    const raw = sessionStorage.getItem(FRAME_KEY);
    return raw ? (JSON.parse(raw) as { mime: string; data: string }) : null;
  } catch {
    return null;
  }
}

/** Once the image studio has it, the still isn't handed over again. */
export function clearSentFrame(): void {
  try {
    sessionStorage.removeItem(FRAME_KEY);
  } catch {
    // already unreadable
  }
}
