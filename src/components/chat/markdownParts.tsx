"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState, type ComponentProps } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

function CodeBlock(props: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const code = props.children as { props?: { className?: string } } | undefined;
  const language = /language-(\S+)/.exec(code?.props?.className ?? "")?.[1];

  const copy = async () => {
    await navigator.clipboard.writeText(ref.current?.innerText ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-black/40">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-xs text-zinc-400">
        <span>{language ?? "код"}</span>
        <button type="button" onClick={copy} className="flex items-center gap-1 hover:text-zinc-100">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
      <pre ref={ref} {...props} className="overflow-x-auto p-3 text-[13px] leading-relaxed" />
    </div>
  );
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
