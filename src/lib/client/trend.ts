"use client";

// «Тренд» in the browser: someone's video cut into its scenes (where the
// picture changes), a frame of each for MARYX to read and for the character
// to step into, and the finished clips put back together with the original
// music, as one file to download.

import type { Frame } from "./frames";
import { imageToAttachment } from "./util";

export interface TrendScene {
  start: number;
  end: number;
  /** The scene's opening frame: the new people step into it, and the clip goes on from it, in time with the original. */
  frame: Frame;
  /** Three moments of the scene side by side (start, middle, end): what MARYX reads the movement from. */
  strip: Frame;
}

/** Scenes a trend is cut into at most (each becomes a picture and a clip). */
export const MAX_SCENES = 6;
/** A scene shorter than this joins its neighbour (a flash, a quick cut). */
const MIN_SCENE = 1.2;
/** How different two moments must look to be a cut (0…1). */
const CUT = 0.32;

function seek(video: HTMLVideoElement, at: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => reject(new Error("Видео не перематывается")), 10_000);
    video.addEventListener("seeked", done);
    video.currentTime = at;
  });
}

/** A coarse colour histogram of what's on screen (to notice cuts). */
function histogram(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, w: number, h: number): Float32Array {
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const bins = new Float32Array(48);
  for (let i = 0; i < data.length; i += 4) {
    bins[data[i] >> 4]++;
    bins[16 + (data[i + 1] >> 4)]++;
    bins[32 + (data[i + 2] >> 4)]++;
  }
  const n = (data.length / 4) * 3;
  for (let i = 0; i < bins.length; i++) bins[i] /= n;
  return bins;
}

/** Three moments of a scene in one picture, side by side. */
async function stripOf(video: HTMLVideoElement, start: number, end: number): Promise<Frame> {
  const h = 360;
  const w = Math.round((h * video.videoWidth) / Math.max(1, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = w * 3 + 8;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [i, part] of [0.12, 0.5, 0.88].entries()) {
    await seek(video, start + (end - start) * part);
    ctx.drawImage(video, i * (w + 4), 0, w, h);
  }
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  if (!blob) throw new Error("Кадр недоступен");
  return imageToAttachment(blob);
}

async function still(video: HTMLVideoElement): Promise<Frame> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("Кадр недоступен");
  return imageToAttachment(blob);
}

/**
 * Cuts the video into its scenes (at most MAX_SCENES; a long single shot is
 * split in even parts) and takes a frame of each.
 */
export async function findScenes(file: Blob): Promise<{ duration: number; scenes: TrendScene[] }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Браузер не смог открыть это видео. Попробуйте другое видео или Chrome/Safari."));
      video.src = url;
    });
    let duration = video.duration;
    // Some recordings don't say how long they are until the end is reached.
    if (!Number.isFinite(duration)) {
      await seek(video, 1e6);
      duration = video.currentTime;
    }
    if (!(duration > 0)) throw new Error("Видео пустое");

    // Where the picture changes: compare moments a fraction of a second apart.
    const w = 48;
    const h = Math.max(1, Math.round((w * video.videoHeight) / Math.max(1, video.videoWidth)));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const step = Math.max(0.2, duration / 90);
    const cuts: number[] = [];
    let previous: Float32Array | null = null;
    for (let at = 0; at < duration; at += step) {
      await seek(video, at);
      const bins = histogram(ctx, video, w, h);
      if (previous) {
        let diff = 0;
        for (let i = 0; i < bins.length; i++) diff += Math.abs(bins[i] - previous[i]);
        if (diff / 2 > CUT) cuts.push(at);
      }
      previous = bins;
    }

    // Scenes between the cuts; too short ones join their neighbour, too many merge.
    let scenes = [0, ...cuts, duration].slice(1).map((end, i, ends) => ({ start: i === 0 ? 0 : ends[i - 1], end }));
    scenes = scenes.reduce<{ start: number; end: number }[]>((list, s) => {
      const last = list[list.length - 1];
      if (last && (s.end - s.start < MIN_SCENE || last.end - last.start < MIN_SCENE)) last.end = s.end;
      else list.push({ ...s });
      return list;
    }, []);
    while (scenes.length > MAX_SCENES) {
      // The shortest pair of neighbours becomes one scene.
      let best = 0;
      for (let i = 1; i < scenes.length - 1; i++) {
        if (scenes[i + 1].end - scenes[i].start < scenes[best + 1].end - scenes[best].start) best = i;
      }
      scenes.splice(best, 2, { start: scenes[best].start, end: scenes[best + 1].end });
    }
    if (scenes.length === 1 && duration > 7) {
      const parts = Math.min(MAX_SCENES, Math.ceil(duration / 5));
      scenes = Array.from({ length: parts }, (_, i) => ({ start: (duration * i) / parts, end: (duration * (i + 1)) / parts }));
    }

    const found: TrendScene[] = [];
    for (const s of scenes) {
      // Just past the cut: a frame right on it can still show the scene before.
      await seek(video, s.start + Math.min(0.3, (s.end - s.start) * 0.15));
      const frame = await still(video);
      found.push({ ...s, frame, strip: await stripOf(video, s.start, s.end) });
    }
    return { duration, scenes: found };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** A clip's length, for its scene: the 5 or 10 seconds a model takes, nearest the original. */
export function clipSeconds(scene: { start: number; end: number }): number {
  return scene.end - scene.start > 7.5 ? 10 : 5;
}

/** One piece of the finished trend: a part of a video, shown for its scene's length. */
export interface Segment {
  src: string;
  /** Where in `src` it starts, in seconds. */
  from: number;
  /** How long it's on screen (the original scene's length). */
  seconds: number;
}

function loaded(video: HTMLVideoElement, src: string, at: number): Promise<void> {
  return new Promise((resolve, reject) => {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => reject(new Error("Не удалось открыть сцену"));
    video.onloadedmetadata = () => {
      if (at <= 0) return resolve();
      video.onseeked = () => resolve();
      video.currentTime = Math.min(at, Math.max(0, video.duration - 0.05));
    };
    video.src = src;
  });
}

/**
 * Plays the pieces one after another into a canvas, each for its scene's
 * length (a longer clip is cut, a shorter one holds its last frame), with
 * the original video's sound underneath, and records it: one file, in time
 * with the music. It takes as long as the trend plays.
 */
export async function renderTrend(
  segments: Segment[],
  music: Blob | null,
  onProgress: (part: number) => void,
  /** The original's proportions (a vertical trend stays vertical); else the first piece's. */
  shape?: { width: number; height: number },
): Promise<{ blob: Blob; ext: string }> {
  if (typeof MediaRecorder === "undefined") throw new Error("Этот браузер не умеет записывать видео — попробуйте Chrome или Safari.");
  const videos = segments.map(() => document.createElement("video"));
  // The first two are ready before recording starts; each next one loads while the one before plays.
  const ready = segments.map((s, i) => (i < 2 ? loaded(videos[i], s.src, s.from) : null));
  await ready[0];
  const size = shape ?? { width: videos[0].videoWidth, height: videos[0].videoHeight };
  const scale = 1280 / Math.max(size.width, size.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size.width * scale) & ~1;
  canvas.height = Math.round(size.height * scale) & ~1;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(30);

  // The trend's own sound (its music) under the new pictures.
  let audio: HTMLAudioElement | null = null;
  let sound: AudioContext | null = null;
  const musicUrl = music ? URL.createObjectURL(music) : null;
  if (musicUrl) {
    audio = new Audio(musicUrl);
    sound = new AudioContext();
    const out = sound.createMediaStreamDestination();
    sound.createMediaElementSource(audio).connect(out);
    out.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }

  const type = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
  const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  const draw = (video: HTMLVideoElement) => {
    const k = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const dw = video.videoWidth * k;
    const dh = video.videoHeight * k;
    ctx.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  };
  const total = segments.reduce((sum, s) => sum + s.seconds, 0);
  recorder.start(250);
  try {
    if (audio) {
      audio.currentTime = segments[0].from;
      await audio.play().catch(() => {});
    }
    let elapsed = 0;
    for (const [i, segment] of segments.entries()) {
      await (ready[i] ?? loaded(videos[i], segment.src, segment.from));
      if (i + 2 < segments.length) ready[i + 2] = loaded(videos[i + 2], segments[i + 2].src, segments[i + 2].from);
      const video = videos[i];
      await video.play().catch(() => {});
      // On screen for the scene's length, by the clock (so the pictures keep time with the music).
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          draw(video);
          const t = (performance.now() - start) / 1000;
          onProgress(Math.min(1, (elapsed + t) / total));
          if (t >= segment.seconds) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      video.pause();
      elapsed += segment.seconds;
    }
  } finally {
    recorder.stop();
    audio?.pause();
    await stopped;
    await sound?.close();
    if (musicUrl) URL.revokeObjectURL(musicUrl);
    videos.forEach((v) => {
      v.removeAttribute("src");
      v.load();
    });
  }
  const mime = recorder.mimeType || type || "video/webm";
  return { blob: new Blob(chunks, { type: mime.split(";")[0] }), ext: mime.includes("mp4") ? "mp4" : "webm" };
}
