"use client";

// The Canvas: games, sites and pictures in code that answers make (an HTML or
// SVG block) open in a panel beside the chat, like Artifacts or Canvas. Every
// such block in a chat is a version; asking for a change makes the next one.

import {
  AppWindow,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Printer,
  RotateCcw,
  Share2,
  X,
} from "lucide-react";
import { createContext, useContext, useRef, useState, type ReactNode, type Ref } from "react";
import { api } from "@/lib/client/api";
import { downloadFile } from "@/lib/client/util";

/** Code a browser can show as a page: an HTML document (a game, a site, a chart) or an SVG picture. */
export function runnable(language: string | undefined, code: string): boolean {
  const lang = language?.toLowerCase();
  if (lang === "html" || lang === "svg") return /</.test(code);
  return /^\s*(<!doctype html|<html[\s>]|<svg[\s>])/i.test(code);
}

const FENCE = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g;

/** The finished runnable blocks of an answer, in order (a block still being written isn't one yet). */
export function artifactsOf(markdown: string): string[] {
  const found: string[] = [];
  for (const [, language, code] of markdown.matchAll(FENCE)) {
    if (runnable(language || undefined, code)) found.push(code.trim());
  }
  return found;
}

/** A name for a page: its <title>, else its first heading. */
export function artifactTitle(code: string): string {
  const pick = (re: RegExp) => re.exec(code)?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || (/^\s*<svg/i.test(code) ? "Рисунок" : "Приложение");
}

/** The document to show: an SVG gets a page around it. */
export function pageOf(code: string): string {
  return /^\s*<svg/i.test(code)
    ? `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${code}</body></html>`
    : code;
}

/** Lets the Canvas ask the page to print itself (a sandboxed page may: allow-modals). */
const PRINT_HOOK = `<script>addEventListener("message",function(e){if(e.data&&e.data.maryx==="print")print()})</script>`;

/**
 * The frame a page runs in: scripts work, but it has no access to this site
 * (no same-origin), can't open windows, navigate the page or submit forms.
 */
export function ArtifactFrame({ code, className = "", ref }: { code: string; className?: string; ref?: Ref<HTMLIFrameElement> }) {
  return (
    <iframe
      ref={ref}
      title="Предпросмотр кода"
      srcDoc={pageOf(code) + PRINT_HOOK}
      sandbox="allow-scripts allow-modals allow-pointer-lock"
      referrerPolicy="no-referrer"
      className={`w-full bg-[#fff] ${className}`}
    />
  );
}

/** What the chat gives the answers' code blocks: their version number, and opening one in the panel. */
export const ArtifactContext = createContext<{ versionOf: (code: string) => number; open: (code: string) => void } | null>(null);

/** An answer's page as a card (the code is a click away), opening in the Canvas. */
export function ArtifactCard({ code, children }: { code: string; children: ReactNode }) {
  const canvas = useContext(ArtifactContext);
  const [showCode, setShowCode] = useState(false);
  const version = canvas?.versionOf(code) ?? 0;
  const ready = version > 0;
  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-violet-300/20 bg-gradient-to-br from-violet-500/[0.08] to-transparent">
      <div className="flex items-center gap-3 p-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/20 text-violet-200">
          {ready ? <AppWindow className="size-5" /> : <LoaderCircle className="size-5 animate-spin" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100">{artifactTitle(code)}</div>
          <div className="text-xs text-zinc-500">{ready ? `Приложение · версия ${version}` : "Пишу код…"}</div>
        </div>
        <button
          type="button"
          onClick={() => setShowCode((s) => !s)}
          title={showCode ? "Скрыть код" : "Показать код"}
          aria-label={showCode ? "Скрыть код" : "Показать код"}
          className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
        >
          <Code2 className="size-4" />
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => canvas?.open(code)}
          className="maryx-button flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm disabled:opacity-50"
        >
          <Eye className="size-4" /> Открыть
        </button>
      </div>
      {showCode && <div className="border-t border-white/10">{children}</div>}
    </div>
  );
}

const ICON_BUTTON = "rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 disabled:opacity-40";

/**
 * The Canvas: the chosen version of the chat's pages, as a preview or its code,
 * with every version a click away and a box to ask for the next change.
 */
export function ArtifactPanel({
  versions,
  index,
  onIndex,
  onClose,
  onAsk,
  busy,
}: {
  versions: string[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Asks the chat for a change to this version; its answer becomes the next version. */
  onAsk?: (text: string, version: number) => void;
  /** An answer is being written: no new ask meanwhile. */
  busy: boolean;
}) {
  const code = versions[index] ?? "";
  const title = artifactTitle(code);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [run, setRun] = useState(0);
  const [full, setFull] = useState(false);
  const [ask, setAsk] = useState("");
  const [status, setStatus] = useState<{ text: string; link?: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const share = async () => {
    setSharing(true);
    setStatus(null);
    try {
      const { url } = await api<{ url: string }>("/api/share", {
        method: "POST",
        body: JSON.stringify({ title, html: pageOf(code) }),
      });
      const link = new URL(url, location.origin).href;
      await navigator.clipboard.writeText(link).catch(() => {});
      setStatus({ text: "Ссылка скопирована — её можно отправить кому угодно.", link });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e) });
    }
    setSharing(false);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(code).catch(() => {});
    setStatus({ text: "Код скопирован." });
  };
  const sendAsk = () => {
    const text = ask.trim();
    if (!text || busy || !onAsk) return;
    onAsk(text, index + 1);
    setAsk("");
    setStatus(null);
  };

  return (
    <aside
      aria-label="Холст"
      className={`flex flex-col bg-zinc-950 ${
        full ? "fixed inset-0 z-50" : "fixed inset-0 z-40 lg:static lg:z-auto lg:w-[min(50%,760px)] lg:shrink-0 lg:border-l lg:border-white/10"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <AppWindow className="size-4 shrink-0 text-violet-300" />
        <span className="min-w-0 truncate text-sm font-medium text-zinc-100" title={title}>
          {title}
        </span>
        <div className="flex shrink-0 items-center rounded-lg bg-white/[0.04] text-xs text-zinc-400">
          <button type="button" aria-label="Предыдущая версия" disabled={index === 0} onClick={() => onIndex(index - 1)} className={ICON_BUTTON}>
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="px-1 tabular-nums">
            v{index + 1} из {versions.length}
          </span>
          <button
            type="button"
            aria-label="Следующая версия"
            disabled={index >= versions.length - 1}
            onClick={() => onIndex(index + 1)}
            className={ICON_BUTTON}
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button type="button" title="Перезапустить" aria-label="Перезапустить" onClick={() => setRun((r) => r + 1)} className={ICON_BUTTON}>
            <RotateCcw className="size-4" />
          </button>
          {tab === "preview" && (
            <button
              type="button"
              title="Печать или PDF (презентация — по слайду на страницу)"
              aria-label="Печать или PDF"
              onClick={() => frame.current?.contentWindow?.postMessage({ maryx: "print" }, "*")}
              className={ICON_BUTTON}
            >
              <Printer className="size-4" />
            </button>
          )}
          <button type="button" title="Копировать код" aria-label="Копировать код" onClick={() => void copy()} className={ICON_BUTTON}>
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            title="Скачать .html"
            aria-label="Скачать"
            onClick={() => downloadFile(`${title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "maryx"}.html`, pageOf(code), "text/html")}
            className={ICON_BUTTON}
          >
            <Download className="size-4" />
          </button>
          <button
            type="button"
            title="Поделиться ссылкой"
            aria-label="Поделиться"
            disabled={sharing}
            onClick={() => void share()}
            className={ICON_BUTTON}
          >
            {sharing ? <LoaderCircle className="size-4 animate-spin" /> : <Share2 className="size-4" />}
          </button>
          <button
            type="button"
            title={full ? "Свернуть" : "Во весь экран"}
            aria-label={full ? "Свернуть" : "Во весь экран"}
            onClick={() => setFull((f) => !f)}
            className={`${ICON_BUTTON} hidden lg:block`}
          >
            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
          <button type="button" title="Закрыть" aria-label="Закрыть холст" onClick={onClose} className={ICON_BUTTON}>
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-white/10 px-3 py-1.5 text-xs">
        {(["preview", "code"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${
              tab === t ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            {t === "preview" ? <Eye className="size-3.5" /> : <Code2 className="size-3.5" />}
            {t === "preview" ? "Просмотр" : "Код"}
          </button>
        ))}
        <span className="ml-auto hidden truncate text-[11px] text-zinc-600 md:inline">
          Изолированное окно — не вводите здесь пароли и личные данные
        </span>
      </div>

      {tab === "preview" ? (
        <ArtifactFrame ref={frame} key={`${index}-${run}`} code={code} className="min-h-0 flex-1" />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto p-4 text-[12.5px] leading-relaxed text-zinc-300">
          <code>{code}</code>
        </pre>
      )}

      {status && (
        <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2 text-xs text-zinc-300">
          <span className="min-w-0 flex-1">{status.text}</span>
          {status.link && (
            <a href={status.link} target="_blank" rel="noreferrer" className="shrink-0 font-medium text-violet-200 underline">
              Открыть
            </a>
          )}
          <button type="button" aria-label="Скрыть" onClick={() => setStatus(null)} className="text-zinc-500 hover:text-zinc-200">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {onAsk && (
        <form
          className="flex items-center gap-2 border-t border-white/10 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            sendAsk();
          }}
        >
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder={busy ? "MARYX пишет новую версию…" : "Что изменить? Например: сделай быстрее и добавь рекорды"}
            aria-label="Что изменить в приложении"
            disabled={busy}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-300/40 disabled:opacity-60"
          />
          <button type="submit" disabled={busy || !ask.trim()} aria-label="Изменить" className="maryx-button rounded-xl p-2.5 disabled:opacity-50">
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </form>
      )}
    </aside>
  );
}
