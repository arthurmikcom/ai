"use client";

import {
  Brain,
  Check,
  ChevronDown,
  Copy,
  CornerDownRight,
  Download,
  FileText,
  Globe,
  Info,
  LoaderCircle,
  RefreshCw,
  Square,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import { speak, stopSpeaking, useSpeaking, useVoiceSupport } from "@/lib/client/voice";
import { isDocumentAttachment } from "@/lib/client/util";
import Link from "next/link";
import { useState } from "react";
import type { ChatMessage, ModelInfo } from "@/lib/types";
import { Markdown } from "./Markdown";
import { BrandMark } from "../Design";

interface Props {
  message: ChatMessage;
  models: ModelInfo[];
  streaming: boolean;
  isLast: boolean;
  onRegenerate?: () => void;
  /** Sends one of MARYX's follow-up suggestions as the next message. */
  onSuggest?: (text: string) => void;
}

function Reasoning({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
      >
        <Brain className={`size-3.5 ${active ? "animate-pulse text-violet-400" : ""}`} />
        {active ? "Размышляет…" : "Ход мыслей"}
        <ChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap border-l-2 border-violet-500/30 pl-3 text-xs leading-relaxed text-zinc-400">
          {text}
        </div>
      )}
    </div>
  );
}

export function MessageView({ message, models, streaming, isLast, onRegenerate, onSuggest }: Props) {
  const [copied, setCopied] = useState(false);
  const speaking = useSpeaking() === message.id;
  const canSpeak = useVoiceSupport()?.speak ?? false;

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-2">
        {message.attachments && (
          <div className="flex flex-wrap justify-end gap-2">
            {message.attachments.map((a, i) =>
              isDocumentAttachment(a) ? (
                a.url ? (
                  <a
                    key={i}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex max-w-64 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-zinc-200 hover:border-violet-300/30"
                  >
                    <FileText className="size-5 shrink-0 text-violet-300" />
                    <span className="truncate">{a.name ?? "Документ"}</span>
                  </a>
                ) : (
                  // Just sent: it gets a link once the chat is reloaded from the server.
                  <div
                    key={i}
                    className="flex max-w-64 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-zinc-200"
                  >
                    <FileText className="size-5 shrink-0 text-violet-300" />
                    <span className="truncate">{a.name ?? "Документ"}</span>
                  </div>
                )
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- local data URL
                <img
                  key={i}
                  src={a.url ?? `data:${a.mime};base64,${a.data}`}
                  alt={a.name ?? "вложение"}
                  className="max-h-48 rounded-xl border border-white/10 object-cover"
                />
              ),
            )}
          </div>
        )}
        {message.content && (
          <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-tr-sm border border-violet-300/10 bg-violet-300/[0.07] px-5 py-3.5 text-[15px] leading-relaxed text-zinc-100">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  const modelLabel =
    models.find((m) => m.provider === message.provider && m.id === message.model)?.label ??
    message.model;
  const drawing = streaming && message.generating === "image" && !message.attachments?.length;
  const waiting = streaming && !drawing && !message.content && !message.reasoning;

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group">
      <div className="mb-4 flex items-center gap-2.5 text-xs font-medium text-zinc-300"><BrandMark className="!size-7 !rounded-lg [&_svg]:!size-5" />
        {message.via === "maryx" ? (
          <>
            MARYX
            {modelLabel && <span className="font-normal text-zinc-500">· {modelLabel}</span>}
          </>
        ) : (
          modelLabel || "MARYX Ai"
        )}
      </div>
      {message.reasoning && (
        <Reasoning text={message.reasoning} active={streaming && !message.content} />
      )}

      {waiting && message.generating === "search" && (
        <div className="flex items-center gap-2 py-2 text-sm text-zinc-400">
          <Globe className="size-4 animate-pulse text-violet-300" />
          Ищу в интернете…
        </div>
      )}

      {waiting && message.generating !== "search" && (
        <div className="flex items-center gap-1.5 py-2">
          <span className="size-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
          <span className="size-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
          <span className="size-2 animate-bounce rounded-full bg-zinc-400" />
        </div>
      )}

      {drawing && (
        <div className="flex aspect-square w-full max-w-sm flex-col items-center justify-center gap-3 rounded-2xl border border-violet-300/15 bg-violet-300/[0.04] text-sm text-zinc-400">
          <LoaderCircle className="size-6 animate-spin text-violet-300" />
          Рисую изображение…
        </div>
      )}

      {message.attachments && (
        <div className="mb-3 flex flex-wrap gap-3">
          {message.attachments.map((a, i) => {
            const src = a.url ?? `data:${a.mime};base64,${a.data}`;
            return (
              <div key={i} className="group/image relative">
                <a href={src} target="_blank" rel="noreferrer" title="Открыть в полном размере">
                  {/* eslint-disable-next-line @next/next/no-img-element -- our own stored file */}
                  <img
                    src={src}
                    alt="Сгенерированное изображение"
                    className="max-h-[28rem] max-w-full rounded-2xl border border-white/10 object-contain"
                  />
                </a>
                <a
                  href={src}
                  download
                  title="Скачать"
                  className="absolute right-2 top-2 rounded-lg bg-black/60 p-1.5 text-zinc-200 opacity-100 backdrop-blur hover:text-white md:opacity-0 md:group-hover/image:opacity-100"
                >
                  <Download className="size-4" />
                </a>
              </div>
            );
          })}
        </div>
      )}

      {message.content && <Markdown text={message.content} />}

      {message.sources && message.sources.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <Globe className="size-3.5" /> Источники
          </div>
          <div className="flex flex-wrap gap-2">
            {message.sources.map((s, i) => {
              let host = s.url;
              try {
                host = new URL(s.url).hostname.replace(/^www\./, "");
              } catch {
                // keep the raw URL
              }
              return (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  title={s.title || s.url}
                  className="flex max-w-xs items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 hover:border-violet-300/30 hover:text-zinc-100"
                >
                  <span className="text-zinc-500">{i + 1}</span>
                  <span className="truncate">{s.title || host}</span>
                  <span className="shrink-0 text-zinc-500">{host}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {message.notice && (
        <div className="mt-2 flex items-start gap-2 rounded-xl bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{message.notice}</span>
        </div>
      )}

      {message.error && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {message.error}
            {message.errorCode === "limit" && (
              <Link href="/pricing" className="ml-2 font-medium text-white underline">
                Тарифы →
              </Link>
            )}
          </span>
        </div>
      )}

      {!streaming && (
        <div
          className={`mt-2 flex items-center gap-1 text-zinc-500 transition ${
            speaking ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
          }`}
        >
          {message.content && canSpeak && (
            <button
              type="button"
              onClick={() => (speaking ? stopSpeaking() : speak(message.id, message.content))}
              title={speaking ? "Остановить" : "Прочитать вслух"}
              aria-label={speaking ? "Остановить" : "Прочитать вслух"}
              className={`rounded-lg p-1.5 hover:bg-white/5 hover:text-zinc-200 ${speaking ? "text-violet-300" : ""}`}
            >
              {speaking ? <Square className="size-4 fill-current" /> : <Volume2 className="size-4" />}
            </button>
          )}
          {message.content && (
            <button
              type="button"
              onClick={copy}
              title="Копировать"
              className="rounded-lg p-1.5 hover:bg-white/5 hover:text-zinc-200"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          )}
          {isLast && onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              title="Сгенерировать заново"
              className="rounded-lg p-1.5 hover:bg-white/5 hover:text-zinc-200"
            >
              <RefreshCw className="size-4" />
            </button>
          )}
          {modelLabel && <span className="ml-1 text-xs">{modelLabel}</span>}
        </div>
      )}

      {isLast && !streaming && onSuggest && message.suggestions && message.suggestions.length > 0 && (
        <div className="mt-3 flex flex-col items-start gap-2" aria-label="Что спросить дальше">
          {message.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="flex max-w-full items-center gap-2 rounded-xl border border-violet-300/15 bg-violet-300/[0.04] px-3 py-1.5 text-left text-sm text-zinc-300 transition hover:border-violet-300/40 hover:text-zinc-50"
            >
              <CornerDownRight className="size-3.5 shrink-0 text-violet-300" />
              <span className="min-w-0">{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
