"use client";

import {
  Brain,
  Check,
  Clapperboard,
  Columns2,
  ChevronDown,
  Copy,
  CornerDownRight,
  Download,
  FileText,
  Globe,
  Info,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Square,
  TriangleAlert,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { useMediaItem } from "@/lib/client/media";
import { BeforeAfter } from "../BeforeAfter";
import { speak, stopSpeaking, useSpeaking, useVoiceSupport } from "@/lib/client/voice";
import { isDocumentAttachment } from "@/lib/client/util";
import Link from "next/link";
import { useState } from "react";
import { PHOTO_EFFECTS } from "@/lib/effects";
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
  /** Only MARYX is offered: answers don't name the model behind it. */
  maryxOnly?: boolean;
  /** Change a picture of this answer: with `prompt` right away (an effect), else in the composer. */
  onEditPicture?: (src: string, prompt?: string) => void;
  /** Bring a picture of this answer to life: a video that starts from it. */
  onAnimatePicture?: (src: string) => void;
  /** The user's last question can be corrected and sent again (its answer is made anew). */
  onEdit?: (text: string) => void;
  /** The photo this answer's picture was made from (to compare before and after). */
  before?: string;
}

/** Correcting a sent question in place. */
function EditQuestion({ text, onSend, onCancel }: { text: string; onSend: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(text);
  const send = () => {
    if (value.trim()) onSend(value.trim());
  };
  return (
    <div className="w-full max-w-[90%] rounded-2xl border border-violet-300/30 bg-violet-300/[0.07] p-3">
      <textarea
        value={value}
        autoFocus
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") onCancel();
        }}
        aria-label="Исправленное сообщение"
        className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-100 outline-none"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">
          Отмена
        </button>
        <button type="button" onClick={send} disabled={!value.trim()} className="maryx-button rounded-lg px-3 py-1.5 text-sm">
          Отправить
        </button>
      </div>
    </div>
  );
}

/** One-click changes to the last answer, sent as the next message (the user sees what was asked). */
const REWRITES = [
  { label: "Короче", text: "Перепиши свой последний ответ короче, сохранив главное." },
  { label: "Подробнее", text: "Раскрой свой последний ответ подробнее, с примерами." },
  { label: "Проще", text: "Объясни свой последний ответ проще, как для новичка." },
  { label: "Списком", text: "Оформи свой последний ответ коротким списком главных пунктов." },
  { label: "На английском", text: "Переведи свой последний ответ на английский язык." },
];

const CHIP =
  "flex items-center gap-1.5 rounded-xl border border-violet-300/15 bg-violet-300/[0.04] px-3 py-1.5 text-sm text-zinc-300 transition hover:border-violet-300/40 hover:text-zinc-50";

/**
 * Under a picture in the chat: change it in words, with a one-click effect
 * (Nano Banana style), or bring it to life as a video.
 */
function PictureActions({
  src,
  onEdit,
  onAnimate,
  comparing,
  onCompare,
}: {
  src: string;
  onEdit?: (src: string, prompt?: string) => void;
  onAnimate?: (src: string) => void;
  comparing?: boolean;
  onCompare?: () => void;
}) {
  const [effects, setEffects] = useState(false);
  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-2">
        {onCompare && (
          <button type="button" onClick={onCompare} aria-pressed={comparing} title="Сравнить с исходным фото" className={CHIP}>
            <Columns2 className="size-3.5 text-violet-300" /> {comparing ? "Обычный вид" : "До / после"}
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={() => onEdit(src)} title="Написать, что изменить на картинке" className={CHIP}>
            <Pencil className="size-3.5 text-violet-300" /> Изменить
          </button>
        )}
        {onAnimate && (
          <button type="button" onClick={() => onAnimate(src)} title="Сделать из картинки видео" className={CHIP}>
            <Clapperboard className="size-3.5 text-violet-300" /> Оживить
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={() => setEffects((open) => !open)}
            aria-expanded={effects}
            title="Готовые эффекты в один клик"
            className={CHIP}
          >
            <WandSparkles className="size-3.5 text-violet-300" /> Эффекты
            <ChevronDown className={`size-3.5 transition ${effects ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {effects && onEdit && (
        <div role="group" aria-label="Эффекты" className="mt-2 flex flex-wrap gap-1.5">
          {PHOTO_EFFECTS.map((e) => (
            <button
              key={e.id}
              type="button"
              title={e.prompt}
              onClick={() => {
                setEffects(false);
                onEdit(src, e.prompt);
              }}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300 transition hover:border-violet-300/40 hover:text-zinc-50"
            >
              <span aria-hidden="true">{e.emoji}</span> {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

/**
 * A video answer: its progress while the clip is made in the background,
 * then the clip (also in the video studio). `failed`: the answer already says why.
 */
function ChatVideo({ id, text, failed }: { id: string; text: string; failed: boolean }) {
  const item = useMediaItem(id);
  if (item === null) return <p className="text-sm text-zinc-500">Видео удалено из галереи.</p>;
  if (item?.status === "failed") {
    return failed ? null : (
      <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>{item.error ?? "Не удалось снять видео. Попробуйте ещё раз."}</span>
      </div>
    );
  }
  const file = item?.status === "succeeded" ? item.files[0] : undefined;
  if (file) {
    return (
      <div className="mb-3">
        <p className="mb-3 text-[15px] text-zinc-100">Готово! Вот ваше видео.</p>
        <div className="group/video relative inline-block max-w-full">
          <video
            src={file.url}
            controls
            playsInline
            preload="metadata"
            className="max-h-[28rem] max-w-full rounded-2xl border border-white/10 bg-black"
          />
          <a
            href={file.url}
            download
            title="Скачать"
            className="absolute right-2 top-2 rounded-lg bg-black/60 p-1.5 text-zinc-200 opacity-100 backdrop-blur hover:text-white md:opacity-0 md:group-hover/video:opacity-100"
          >
            <Download className="size-4" />
          </a>
        </div>
      </div>
    );
  }
  const source = item?.inputs?.[0]?.url;
  return (
    <div className="mb-3">
      {text && <p className="mb-3 text-[15px] text-zinc-300">{text}</p>}
      <div
        role="status"
        className={`relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-violet-300/15 bg-violet-300/[0.04] text-sm text-zinc-300 ${
          item?.aspectRatio === "9:16" ? "aspect-[9/16] max-w-60" : "aspect-video max-w-md"
        }`}
      >
        {source && (
          // eslint-disable-next-line @next/next/no-img-element -- our own stored file
          <img src={source} alt="" className="absolute inset-0 size-full object-cover opacity-25 blur-[1px]" />
        )}
        <LoaderCircle className="relative size-6 animate-spin text-violet-300" />
        <span className="relative">
          {source ? "Оживляю фото…" : "Снимаю видео…"}
          {item?.progress ? ` ${item.progress}%` : ""}
        </span>
        <span className="relative text-xs text-zinc-500">Обычно 1–5 минут</span>
      </div>
    </div>
  );
}

export function MessageView({
  message,
  models,
  streaming,
  isLast,
  onRegenerate,
  onSuggest,
  maryxOnly,
  onEditPicture,
  onAnimatePicture,
  onEdit,
  before,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const speaking = useSpeaking() === message.id;
  const canSpeak = useVoiceSupport()?.speak ?? false;

  if (message.role === "user") {
    return (
      <div className="group/question flex flex-col items-end gap-2">
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
        {editing && onEdit ? (
          <EditQuestion
            text={message.content}
            onCancel={() => setEditing(false)}
            onSend={(text) => {
              setEditing(false);
              onEdit(text);
            }}
          />
        ) : (
          message.content && (
            <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-tr-sm border border-violet-300/10 bg-violet-300/[0.07] px-5 py-3.5 text-[15px] leading-relaxed text-zinc-100">
              {message.content}
            </div>
          )
        )}
        {onEdit && !editing && message.content && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Исправить вопрос и спросить заново"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-500 opacity-100 transition hover:bg-white/5 hover:text-zinc-200 md:opacity-0 md:group-hover/question:opacity-100"
          >
            <Pencil className="size-3.5" /> Изменить
          </button>
        )}
        {/* A question left without an answer (e.g. the tab was closed mid-answer) can be asked again. */}
        {isLast && !streaming && onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <RefreshCw className="size-3.5" /> Ответить
          </button>
        )}
      </div>
    );
  }

  const modelLabel = maryxOnly
    ? undefined
    : (models.find((m) => m.provider === message.provider && m.id === message.model)?.label ?? message.model);
  const drawing = streaming && message.generating === "image" && !message.attachments?.length;
  // The picture this answer drew (or edited), which can be changed further.
  const picture = message.attachments?.find((a) => a.mime.startsWith("image/") && a.url)?.url;
  // A video answer starting (the clip itself is made in the background).
  const filming = streaming && message.generating === "video" && !message.mediaId;
  const waiting = streaming && !drawing && !filming && !message.content && !message.reasoning;

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group">
      <div className="mb-4 flex items-center gap-2.5 text-xs font-medium text-zinc-300"><BrandMark className="!size-7 !rounded-lg [&_svg]:!size-5" />
        {maryxOnly ? (
          "MARYX"
        ) : message.via === "maryx" ? (
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

      {waiting && message.status && (
        <div className="flex items-center gap-2 py-2 text-sm text-zinc-400" role="status">
          <LoaderCircle className="size-4 animate-spin text-violet-300" />
          {message.status}
        </div>
      )}

      {waiting && !message.status && message.generating === "search" && (
        <div className="flex items-center gap-2 py-2 text-sm text-zinc-400">
          <Globe className="size-4 animate-pulse text-violet-300" />
          Ищу в интернете…
        </div>
      )}

      {waiting && !message.status && message.generating !== "search" && (
        <div className="flex items-center gap-1.5 py-2">
          <span className="size-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
          <span className="size-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
          <span className="size-2 animate-bounce rounded-full bg-zinc-400" />
        </div>
      )}

      {filming && (
        <div className="flex aspect-video w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-violet-300/15 bg-violet-300/[0.04] text-sm text-zinc-400">
          <LoaderCircle className="size-6 animate-spin text-violet-300" />
          Запускаю съёмку…
        </div>
      )}

      {message.mediaId && <ChatVideo id={message.mediaId} text={message.content} failed={Boolean(message.error)} />}

      {drawing && (
        <div className="flex aspect-square w-full max-w-sm flex-col items-center justify-center gap-3 rounded-2xl border border-violet-300/15 bg-violet-300/[0.04] text-sm text-zinc-400">
          <LoaderCircle className="size-6 animate-spin text-violet-300" />
          Рисую изображение…
        </div>
      )}

      {comparing && before && picture ? (
        <BeforeAfter before={before} after={picture} className="mb-3 inline-block max-w-full rounded-2xl border border-white/10" />
      ) : message.attachments && (
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

      {!streaming && (onEditPicture || onAnimatePicture || before) && picture && (
        <PictureActions
          src={picture}
          onEdit={onEditPicture}
          onAnimate={onAnimatePicture}
          comparing={comparing}
          onCompare={before ? () => setComparing((c) => !c) : undefined}
        />
      )}

      {message.content && !message.mediaId && <Markdown text={message.content} />}

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
                Тарифы и кредиты →
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

      {isLast && !streaming && onSuggest && message.content && !message.error && !message.mediaId && !picture && (
        <div role="group" aria-label="Изменить ответ" className="mt-2 flex flex-wrap items-center gap-1.5">
          {REWRITES.map((r) => (
            <button
              key={r.label}
              type="button"
              title={r.text}
              onClick={() => onSuggest(r.text)}
              className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-zinc-400 transition hover:border-violet-300/40 hover:text-zinc-100"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {isLast && !streaming && onSuggest && message.suggestions && message.suggestions.length > 0 && (
        <div role="group" className="mt-3 flex flex-col items-start gap-2" aria-label="Что спросить дальше">
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
