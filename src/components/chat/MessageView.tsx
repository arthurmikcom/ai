"use client";

import { Brain, Check, ChevronDown, Copy, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { ChatMessage, ModelInfo } from "@/lib/types";
import { Markdown } from "./Markdown";

interface Props {
  message: ChatMessage;
  models: ModelInfo[];
  streaming: boolean;
  isLast: boolean;
  onRegenerate?: () => void;
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

export function MessageView({ message, models, streaming, isLast, onRegenerate }: Props) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-2">
        {message.attachments && (
          <div className="flex flex-wrap justify-end gap-2">
            {message.attachments.map((a, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- local data URL
              <img
                key={i}
                src={`data:${a.mime};base64,${a.data}`}
                alt={a.name ?? "вложение"}
                className="max-h-48 rounded-xl border border-white/10 object-cover"
              />
            ))}
          </div>
        )}
        {message.content && (
          <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-zinc-800 px-4 py-2.5 text-[15px] leading-relaxed text-zinc-100">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  const modelLabel =
    models.find((m) => m.provider === message.provider && m.id === message.model)?.label ??
    message.model;
  const waiting = streaming && !message.content && !message.reasoning;

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group">
      {message.reasoning && (
        <Reasoning text={message.reasoning} active={streaming && !message.content} />
      )}

      {waiting && (
        <div className="flex items-center gap-1.5 py-2">
          <span className="size-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
          <span className="size-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
          <span className="size-2 animate-bounce rounded-full bg-zinc-400" />
        </div>
      )}

      {message.content && <Markdown text={message.content} />}

      {message.notice && (
        <div className="mt-2 flex items-start gap-2 rounded-xl bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{message.notice}</span>
        </div>
      )}

      {message.error && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{message.error}</span>
        </div>
      )}

      {!streaming && (
        <div className="mt-2 flex items-center gap-1 text-zinc-500 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
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
    </div>
  );
}
