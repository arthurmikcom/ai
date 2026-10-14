"use client";

import { ArrowUp, Brain, Paperclip, Square, X } from "lucide-react";
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { imageToAttachment } from "@/lib/client/util";
import type { Attachment, ModelInfo } from "@/lib/types";

interface Props {
  model: ModelInfo | undefined;
  disabled: boolean;
  streaming: boolean;
  deepThinking: boolean;
  onDeepThinkingChange: (value: boolean) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}

const MAX_ATTACHMENTS = 4;

export function Composer({
  model,
  disabled,
  streaming,
  deepThinking,
  onDeepThinkingChange,
  onSend,
  onStop,
}: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const canAttach = model?.vision !== false;
  const canSend = !disabled && !streaming && (text.trim() !== "" || attachments.length > 0);

  const addFiles = async (files: File[]) => {
    setError(null);
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length < files.length) setError("Пока можно прикреплять только изображения.");
    const room = MAX_ATTACHMENTS - attachments.length;
    try {
      const converted = await Promise.all(images.slice(0, room).map(imageToAttachment));
      setAttachments((a) => [...a, ...converted]);
    } catch {
      setError("Не удалось прочитать изображение.");
    }
  };

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), attachments);
    setText("");
    setAttachments([]);
    setError(null);
    if (textarea.current) textarea.current.style.height = "auto";
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length && canAttach) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="composer-panel rounded-3xl border p-3 transition-colors">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                <img
                  src={`data:${a.mime};base64,${a.data}`}
                  alt={a.name ?? ""}
                  className="size-16 rounded-xl object-cover"
                />
                <button
                  type="button"
                  onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-zinc-700 p-0.5 text-zinc-200 hover:bg-zinc-600"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textarea}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={disabled ? "Сначала подключите провайдера в настройках" : "Спросите что угодно…"}
          aria-label="Сообщение"
          disabled={disabled}
          className="max-h-60 w-full resize-none bg-transparent px-3 py-2 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
        />

        <div className="flex items-center gap-1 px-1">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            title={canAttach ? "Прикрепить изображение" : "Модель не принимает изображения"}
            disabled={!canAttach || disabled || attachments.length >= MAX_ATTACHMENTS}
            onClick={() => fileInput.current?.click()}
            className="rounded-full p-2 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100 disabled:opacity-40"
          >
            <Paperclip className="size-5" />
          </button>

          {model?.reasoning && (
            <button
              type="button"
              onClick={() => onDeepThinkingChange(!deepThinking)}
              aria-pressed={deepThinking}
              title="Модель дольше размышляет над ответом"
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
                deepThinking
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Brain className="size-4" />
              Думать глубже
            </button>
          )}

          <div className="flex-1" />

          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              title="Остановить"
              className="nexus-button rounded-xl p-2.5"
            >
              <Square className="size-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              title="Отправить"
              className="nexus-button rounded-xl p-2.5 disabled:!bg-zinc-800 disabled:!text-zinc-500"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-center text-xs text-red-300">{error}</p>}
    </div>
  );
}
