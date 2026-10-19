"use client";

// Pictures made in the browser from this device: a camera shot, a screenshot of
// a screen or window, and a video's frames on one sheet. Nothing but the
// resulting picture leaves the device.

const MAX_SIDE = 1568;

/** The current frame of a playing video as a JPEG, its longest side at most `max`. */
export function frameOf(video: HTMLVideoElement, max = MAX_SIDE): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось сохранить кадр"))), "image/jpeg", 0.85),
  );
}

/** Waits for an element's event, failing after `ms`. */
function once(target: HTMLElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Видео не отвечает")), ms);
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Whether this browser can share a screen (desktop browsers; phones can't). */
export function canCaptureScreen(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/** Whether this browser can use a camera. */
export function canUseCamera(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/**
 * A screenshot of a screen, window or tab the user picks (the browser asks
 * first and shows that it's shared). Sharing stops right after the shot.
 */
export async function captureScreen(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await once(video, "resize", 3000);
    // A moment for the first full frame.
    await new Promise((r) => setTimeout(r, 250));
    return await frameOf(video);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A video as one picture: up to 9 frames evenly through it, each marked with
 * its time, so a model that reads pictures can tell what happens and when.
 * The video is read right here; only the sheet is sent.
 */
export async function videoSheet(file: Blob): Promise<{ sheet: Blob; duration: number; frames: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const loaded = once(video, "loadeddata", 15_000);
    video.src = url;
    await loaded.catch(() => {
      throw new Error("Не удалось открыть видео — сохраните его как MP4.");
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth) throw new Error("Не удалось прочитать видео — сохраните его как MP4.");

    const frames = duration < 6 ? 4 : 9;
    const cols = frames === 4 ? 2 : 3;
    const portrait = video.videoHeight > video.videoWidth;
    const [cellW, cellH] = portrait ? [288, 512] : [512, 288];
    const canvas = document.createElement("canvas");
    canvas.width = cols * cellW;
    canvas.height = Math.ceil(frames / cols) * cellH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "600 22px system-ui, sans-serif";
    ctx.textBaseline = "top";

    for (let i = 0; i < frames; i++) {
      const t = (duration * (i + 0.5)) / frames;
      const seeked = once(video, "seeked", 8000);
      video.currentTime = t;
      await seeked;
      // Fit the frame in its cell, keeping its shape.
      const scale = Math.min(cellW / video.videoWidth, cellH / video.videoHeight);
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      const x = (i % cols) * cellW + (cellW - w) / 2;
      const y = Math.floor(i / cols) * cellH + (cellH - h) / 2;
      ctx.drawImage(video, x, y, w, h);
      const label = clock(t);
      const lx = (i % cols) * cellW + 8;
      const ly = Math.floor(i / cols) * cellH + 8;
      ctx.fillStyle = "rgba(0,0,0,.65)";
      ctx.fillRect(lx, ly, ctx.measureText(label).width + 14, 30);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, lx + 7, ly + 4);
    }
    const sheet = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось собрать кадры"))), "image/jpeg", 0.82),
    );
    return { sheet, duration, frames };
  } finally {
    video.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
