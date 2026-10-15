"use client";

// Voice in the browser: recording dictation, the Web Speech API as a fallback
// recognizer, and reading answers aloud with the system's voices (free).

import { useSyncExternalStore } from "react";
import { errorOf } from "./api";

// ---------- Recording ----------

const MAX_RECORDING_MS = 120_000;

export function canRecord(): boolean {
  return typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && "MediaRecorder" in window;
}

function pickMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export interface Recording {
  /** Stops and returns the clip. */
  stop: () => Promise<Blob>;
  /** Stops and throws the clip away. */
  cancel: () => void;
}

/** Starts recording from the microphone; stops by itself after two minutes. */
export async function startRecording(onLimit: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const timer = setTimeout(onLimit, MAX_RECORDING_MS);
  recorder.start();

  return {
    stop: () =>
      new Promise((resolve) => {
        clearTimeout(timer);
        recorder.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
        };
        if (recorder.state === "inactive") recorder.onstop(new Event("stop"));
        else recorder.stop();
      }),
    cancel: () => {
      clearTimeout(timer);
      recorder.onstop = release;
      if (recorder.state !== "inactive") recorder.stop();
      else release();
    },
  };
}

/** Sends a clip to the server and returns the recognized text. */
export async function transcribe(clip: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", clip, "voice");
  const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
  if (!res.ok) throw await errorOf(res);
  return ((await res.json()) as { text: string }).text;
}

// ---------- Browser recognition (fallback) ----------

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canRecognizeInBrowser(): boolean {
  return recognitionCtor() !== null;
}

/** One phrase through the browser's recognizer (Chrome sends audio to Google). */
export function recognizeOnce(): { result: Promise<string>; stop: () => void } {
  const Ctor = recognitionCtor();
  if (!Ctor) return { result: Promise.reject(new Error("Браузер не умеет распознавать речь")), stop: () => {} };
  const rec = new Ctor();
  rec.lang = "ru-RU";
  rec.interimResults = false;
  rec.continuous = false;
  const result = new Promise<string>((resolve, reject) => {
    let text = "";
    rec.onresult = (e) => {
      for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
    };
    rec.onerror = (e) =>
      reject(new Error(e.error === "not-allowed" ? "Нет доступа к микрофону" : "Не удалось распознать речь"));
    rec.onend = () => resolve(text.trim());
  });
  rec.start();
  return { result, stop: () => rec.stop() };
}

// ---------- What this browser can do ----------

export interface VoiceSupport {
  record: boolean;
  recognize: boolean;
  speak: boolean;
}

let support: VoiceSupport | null = null;

/** Browser voice features; null during server rendering. */
export function useVoiceSupport(): VoiceSupport | null {
  return useSyncExternalStore(
    () => () => {},
    () => (support ??= { record: canRecord(), recognize: canRecognizeInBrowser(), speak: canSpeak() }),
    () => null,
  );
}

// ---------- Reading aloud ----------

let speakingId: string | null = null;
const listeners = new Set<() => void>();

function setSpeaking(id: string | null) {
  speakingId = id;
  listeners.forEach((l) => l());
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Id of the message being read aloud right now, or null. */
export function useSpeaking(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => speakingId,
    () => null,
  );
}

/** Markdown → plain text worth hearing (no code, links read as their words). */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " Код показан на экране. ")
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, " Формула показана на экране. ")
    // Inline formulas lose their delimiters; prices ("$5", "20$", "100 $") keep the sign.
    .replace(/(?<!\\)\\\(([\s\S]+?)\\\)/g, "$1")
    .replace(/(?<![\d\\])\$(?=[^\s$])([^$\n]*?[^\s$])\$(?!\d)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\|?[-:\s|]+\|?\s*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[*_~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sentence-sized pieces: Chrome's online voices silently stop after about
 * 15 seconds of continuous speech, so long answers are queued in parts.
 */
function chunks(text: string, max = 180): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const out: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > max && current) {
      out.push(current.trim());
      current = "";
    }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
    } else {
      current += s;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

function voiceFor(text: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const cyrillic = (text.match(/[а-яё]/gi)?.length ?? 0) > text.length * 0.2;
  if (!cyrillic) return undefined;
  const russian = voices.filter((v) => v.lang?.replace("_", "-").toLowerCase().startsWith("ru"));
  // Natural/online voices sound far better where the browser has them.
  return russian.find((v) => /natural|online|google/i.test(v.name)) ?? russian[0];
}

let primed = false;

/**
 * iOS only lets a page speak after speech was started from a tap. Called from
 * the mic and talk-mode buttons, so the answer can be read out later on its own.
 */
export function primeSpeech(): void {
  if (primed || !canSpeak()) return;
  primed = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  setSpeaking(null);
}

/** Reads a message aloud; any other message being read stops. */
export function speak(id: string, markdown: string): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const text = speakableText(markdown);
  const parts = chunks(text);
  if (!parts.length) return setSpeaking(null);
  const voice = voiceFor(text);
  setSpeaking(id);
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else if (/[а-яё]/i.test(text)) {
      u.lang = "ru-RU"; // voices may still be loading; let the browser pick a Russian one
    }
    if (i === parts.length - 1) {
      u.onend = () => speakingId === id && setSpeaking(null);
    }
    u.onerror = () => speakingId === id && setSpeaking(null);
    window.speechSynthesis.speak(u);
  });
}
