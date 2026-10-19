"use client";

import { Check, Copy, Download, Maximize2, Minimize2, Play, RotateCcw, X } from "lucide-react";
import { isValidElement, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { downloadFile } from "@/lib/client/util";
import { ArtifactCard, ArtifactContext, ArtifactFrame, pageOf, runnable } from "./artifacts";

/** The plain text of highlighted code (its tokens are nested elements). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/**
 * Runs an answer's page in a full-screen frame (where there's no Canvas, see
 * artifacts.tsx), with restart and download.
 */
function CodePreview({ code, onClose }: { code: string; onClose: () => void }) {
  const [run, setRun] = useState(0);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const button = "rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100";
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Предпросмотр"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm md:p-6"
      onClick={onClose}
    >
      <div
        className={`flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl ${
          full ? "size-full" : "h-[85vh] w-full max-w-5xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-zinc-400">
          <Play className="size-3.5 shrink-0 text-violet-300" />
          <span className="shrink-0 font-medium text-zinc-200">Предпросмотр</span>
          <span className="hidden truncate md:inline">
            Код из ответа ИИ работает в изолированном окне — не вводите здесь пароли и личные данные.
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <button type="button" title="Перезапустить" aria-label="Перезапустить" onClick={() => setRun((r) => r + 1)} className={button}>
              <RotateCcw className="size-4" />
            </button>
            <button type="button" title="Скачать .html" aria-label="Скачать" onClick={() => downloadFile("maryx.html", pageOf(code), "text/html")} className={button}>
              <Download className="size-4" />
            </button>
            <button
              type="button"
              title={full ? "Свернуть" : "Во весь экран"}
              aria-label={full ? "Свернуть" : "Во весь экран"}
              onClick={() => setFull((f) => !f)}
              className={button}
            >
              {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button type="button" title="Закрыть" aria-label="Закрыть" onClick={onClose} className={button}>
              <X className="size-4" />
            </button>
          </div>
        </div>
        <ArtifactFrame key={run} code={code} className="min-h-0 flex-1" />
      </div>
    </div>,
    document.body,
  );
}

function CodeBlock(props: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const code = props.children as { props?: { className?: string; children?: ReactNode } } | undefined;
  const language = /language-(\S+)/.exec(code?.props?.className ?? "")?.[1];
  const source = textOf(code?.props?.children).trim();
  const canRun = runnable(language, source);
  const canvas = useContext(ArtifactContext);

  const copy = async () => {
    await navigator.clipboard.writeText(ref.current?.innerText ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const block = (
    <div className={canvas && canRun ? "bg-black/40" : "my-3 overflow-hidden rounded-xl border border-white/10 bg-black/40"}>
      <div className="flex items-center gap-3 border-b border-white/10 px-3 py-1.5 text-xs text-zinc-400">
        <span className="mr-auto">{language ?? "код"}</span>
        {canRun && !canvas && (
          <button
            type="button"
            onClick={() => setRunning(true)}
            title="Открыть результат прямо здесь"
            className="flex items-center gap-1 rounded-md bg-violet-500/20 px-2 py-0.5 font-medium text-violet-100 hover:bg-violet-500/30"
          >
            <Play className="size-3.5 fill-current" /> Запустить
          </button>
        )}
        <button type="button" onClick={copy} className="flex items-center gap-1 hover:text-zinc-100">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
      <pre ref={ref} {...props} className="overflow-x-auto p-3 text-[13px] leading-relaxed" />
      {running && <CodePreview code={source} onClose={() => setRunning(false)} />}
    </div>
  );
  // In the chat, a page is a card that opens in the Canvas; its code is a click away.
  return canvas && canRun ? <ArtifactCard code={source}>{block}</ArtifactCard> : block;
}

const components: Components = {
  pre: CodeBlock,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  // Answers can repeat text planted in web pages or documents. A remote
  // image would load by itself and could carry chat details to a third
  // party in its URL, so only our own files show inline; others become links.
  img: ({ src, alt }) =>
    typeof src === "string" && (src.startsWith("/api/files/") || src.startsWith("data:image/")) ? (
      // eslint-disable-next-line @next/next/no-img-element -- our own stored file
      <img src={src} alt={alt ?? ""} className="max-h-96 rounded-xl" />
    ) : (
      <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noopener noreferrer nofollow">
        {alt || "изображение"}
      </a>
    ),
};

type Plugins = NonNullable<Options["remarkPlugins"]>;

/** Markdown of a chat answer; the math renderer adds its own plugins. */
export function MarkdownBody({
  text,
  remark = [],
  rehype = [],
}: {
  text: string;
  remark?: Plugins;
  rehype?: NonNullable<Options["rehypePlugins"]>;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...remark]}
        rehypePlugins={[...rehype, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
