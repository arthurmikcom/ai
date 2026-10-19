"use client";

import { Camera, LoaderCircle, SwitchCamera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { frameOf } from "@/lib/client/capture";

/** Takes a photo with the device's camera, right in the chat (the browser asks first). */
export function CameraDialog({ onShot, onClose }: { onShot: (photo: Blob) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
          setLive(true);
        }
      })
      .catch((e: unknown) => {
        const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
        setError(denied ? "Разрешите доступ к камере в настройках браузера." : "Камера недоступна.");
      });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      stream?.getTracks().forEach((t) => t.stop());
      window.removeEventListener("keydown", onKey);
    };
  }, [facing, onClose]);

  const shoot = async () => {
    if (!video.current?.videoWidth) return;
    onShot(await frameOf(video.current));
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Камера" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3">
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-sm text-zinc-200">
          <Camera className="size-4 text-violet-300" /> Снять фото
          <button type="button" onClick={onClose} aria-label="Закрыть" className="ml-auto rounded-lg p-1.5 text-zinc-400 hover:text-zinc-100">
            <X className="size-4" />
          </button>
        </div>
        <div className="relative flex aspect-video items-center justify-center bg-black">
          <video ref={video} playsInline muted className="size-full object-contain" />
          {!live && !error && <LoaderCircle className="absolute size-6 animate-spin text-violet-300" />}
          {error && <p className="absolute px-6 text-center text-sm text-red-200">{error}</p>}
        </div>
        <div className="flex items-center justify-center gap-3 p-3">
          <button
            type="button"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            title="Сменить камеру"
            aria-label="Сменить камеру"
            className="rounded-full border border-white/10 p-2.5 text-zinc-300 hover:text-zinc-100"
          >
            <SwitchCamera className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => void shoot()}
            disabled={!live}
            aria-label="Сделать снимок"
            className="maryx-button flex items-center gap-2 rounded-full px-5 py-2.5 text-sm disabled:opacity-50"
          >
            <Camera className="size-4" /> Снять
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
