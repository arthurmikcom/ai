"use client";

import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Columns2,
  Eye,
  FileText,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PenLine,
  Printer,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { api } from "@/lib/client/api";
import { downloadFile } from "@/lib/client/util";
import { Markdown } from "./Markdown";
import { MarkdownBody } from "./markdownParts";
import { useWorkbenchPanel } from "./useWorkbenchPanel";

/** One-click edits (the server knows each task's instruction). */
const ACTIONS = [
  { task: "improve", label: "Улучшить", emoji: "✨" },
  { task: "shorter", label: "Короче", emoji: "✂️" },
  { task: "longer", label: "Подробнее", emoji: "📖" },
  { task: "fix", label: "Исправить ошибки", emoji: "✅" },
  { task: "simpler", label: "Проще", emoji: "🧒" },
  { task: "formal", label: "Официальнее", emoji: "👔" },
  { task: "friendly", label: "Дружелюбнее", emoji: "😊" },
  { task: "emoji", label: "Эмодзи", emoji: "🎉" },
  { task: "english", label: "На английский", emoji: "🇬🇧" },
] as const;

/** Versions kept per document (each MARYX edit is one). */
const MAX_VERSIONS = 30;
const ICON_BUTTON = "rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100 disabled:opacity-30";

interface Saved {
  versions: string[];
  index: number;
}

const storageKey = (id: string) => `maryx:doc:${id}`;

/** The edits made earlier on this device, or the answer as it is. */
function load(id: string, text: string): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(id)) ?? "null") as Saved | null;
    if (saved && Array.isArray(saved.versions) && saved.versions.length && saved.versions.every((v) => typeof v === "string")) {
      return { versions: saved.versions, index: Math.min(Math.max(0, saved.index | 0), saved.versions.length - 1) };
    }
  } catch {
    // Storage blocked or broken: start from the answer.
  }
  return { versions: [text], index: 0 };
}

/** The document's name: its first heading, else its first line. */
function titleOf(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return (
    line
      .replace(/^#+\s*/, "")
      .replace(/[*_`>#]/g, "")
      .trim()
      .slice(0, 60) || "Документ"
  );
}

/** The document as HTML (for Word, print and copying with formatting). */
function htmlOf(text: string): string {
  const el = document.createElement("div");
  const root = createRoot(el);
  flushSync(() => root.render(<MarkdownBody text={text} />));
  // Code blocks' copy and run buttons aren't part of the text.
  el.querySelectorAll("button").forEach((b) => b.remove());
  const html = el.innerHTML;
  root.unmount();
  return html;
}

function pageOf(title: string, body: string, word = false): string {
  const esc = title.replace(/[<&>]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;" })[c]!);
  return `<!doctype html><html${word ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"' : ""}><head><meta charset="utf-8"><title>${esc}</title><style>
body{font-family:Calibri,Arial,sans-serif;font-size:12pt;line-height:1.55;color:#111;max-width:760px;margin:32px auto;padding:0 24px}
h1,h2,h3{line-height:1.25}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}
pre{background:#f4f4f5;padding:10px;white-space:pre-wrap}code{font-family:Consolas,monospace}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:12px;color:#444}
@media print{body{margin:0}}
</style></head><body>${body}</body></html>`;
}

const fileName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "документ";

/**
 * «Холст для текстов» (like ChatGPT Canvas): an answer opened as a document to
 * edit right here — by hand, or by MARYX in one click on the selected part (or
 * on the whole text). Every MARYX edit is a version; the edits are kept on
 * this device.
 */
export function DocumentPanel({ id, text, onClose }: { id: string; text: string; onClose: () => void }) {
  const [doc, setDoc] = useState<Saved>(() => load(id, text));
  const current = doc.versions[doc.index] ?? "";
  const [tab, setTab] = useState<"edit" | "preview" | "split">("edit");
  const [tools, setTools] = useState(true);
  const [full, setFull] = useState(false);
  const panel = useWorkbenchPanel(full, onClose);
  const [selection, setSelection] = useState<[number, number]>([0, 0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  // What MARYX just rewrote: selected once it's on screen, so it's easy to see.
  const changed = useRef<[number, number] | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(doc));
    } catch {
      // Storage full or blocked: the document stays open, just not kept.
    }
    const range = changed.current;
    if (range && editor.current) {
      changed.current = null;
      editor.current.focus();
      editor.current.setSelectionRange(range[0], range[1]);
    }
  }, [id, doc]);

  const [start, end] = selection[1] > selection[0] && selection[1] <= current.length ? selection : [0, current.length];
  const partial = start > 0 || end < current.length;
  const words = current.trim() ? current.trim().split(/\s+/).length : 0;

  const type = (value: string) =>
    setDoc((d) => ({ ...d, versions: d.versions.map((v, i) => (i === d.index ? value : v)) }));

  const run = async (task: string, instruction?: string) => {
    const part = current.slice(start, end);
    if (!part.trim() || busy) return;
    setBusy(task);
    setStatus(null);
    try {
      const res = await api<{ text: string }>("/api/rewrite", {
        method: "POST",
        body: JSON.stringify({ text: part, task, instruction, document: partial ? current : undefined }),
      });
      // The fragment's own spaces and line breaks around it stay as they were.
      const lead = part.match(/^\s*/)![0];
      const trail = part.slice(lead.length).match(/\s*$/)![0];
      const next = current.slice(0, start) + lead + res.text + trail + current.slice(end);
      changed.current = [start + lead.length, start + lead.length + res.text.length];
      setSelection(changed.current);
      setTab("edit");
      setDoc((d) => {
        const versions = [...d.versions, next].slice(-MAX_VERSIONS);
        return { versions, index: versions.length - 1 };
      });
      setAsk("");
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : String(e), error: true });
    }
    setBusy(null);
  };

  const title = titleOf(current);
  const copy = async () => {
    try {
      const html = htmlOf(current);
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([current], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(current).catch(() => {});
    }
    setStatus({ text: "Скопировано — вставьте в Word, Google Docs или письмо, оформление сохранится." });
  };
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) {
      setStatus({ text: "Браузер не дал открыть окно печати — разрешите всплывающие окна.", error: true });
      return;
    }
    w.document.write(pageOf(title, htmlOf(current)));
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <aside
      ref={panel}
      aria-label="Документ"
      className={`workbench document-workbench flex flex-col bg-zinc-950 ${
        full ? "fixed inset-0 z-50" : "fixed inset-0 z-40 lg:static lg:z-auto lg:w-[min(50%,760px)] lg:shrink-0 lg:border-l lg:border-white/10"
      }`}
    >
      <div className="workbench-intro"><span><FileText size={13} />Холст текста</span><small>На этом устройстве</small></div>
      <div className="workbench-toolbar flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <FileText className="size-4 shrink-0 text-violet-300" />
        <span className="min-w-0 truncate text-sm font-medium text-zinc-100" title={title}>
          {title}
        </span>
        <div className="flex shrink-0 items-center rounded-lg bg-white/[0.04] text-xs text-zinc-400">
          <button
            type="button"
            aria-label="Предыдущая версия"
            disabled={doc.index === 0 || busy !== null}
            onClick={() => setDoc((d) => ({ ...d, index: d.index - 1 }))}
            className={ICON_BUTTON}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="px-1 tabular-nums" aria-label="Версия">
            v{doc.index + 1} из {doc.versions.length}
          </span>
          <button
            type="button"
            aria-label="Следующая версия"
            disabled={doc.index >= doc.versions.length - 1 || busy !== null}
            onClick={() => setDoc((d) => ({ ...d, index: d.index + 1 }))}
            className={ICON_BUTTON}
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button type="button" title="Копировать с оформлением" aria-label="Копировать документ" onClick={() => void copy()} className={ICON_BUTTON}>
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            title="Скачать для Word (.doc)"
            aria-label="Скачать Word"
            onClick={() => downloadFile(`${fileName(title)}.doc`, pageOf(title, htmlOf(current), true), "application/msword")}
            className={`${ICON_BUTTON} text-[11px] font-semibold`}
          >
            DOC
          </button>
          <button
            type="button"
            title="Скачать Markdown (.md)"
            aria-label="Скачать Markdown"
            onClick={() => downloadFile(`${fileName(title)}.md`, current, "text/markdown;charset=utf-8")}
            className={`${ICON_BUTTON} text-[11px] font-semibold`}
          >
            MD
          </button>
          <button type="button" title="Печать или PDF" aria-label="Печать или PDF" onClick={print} className={ICON_BUTTON}>
            <Printer className="size-4" />
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
          <button type="button" title="Закрыть" aria-label="Закрыть документ" data-workbench-close onClick={onClose} className={ICON_BUTTON}>
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-white/10 px-3 py-1.5 text-xs">
        {(["edit", "preview", "split"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${
              tab === t ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            {t === "edit" ? <PenLine className="size-3.5" /> : t === "split" ? <Columns2 className="size-3.5" /> : <Eye className="size-3.5" />}
            {t === "edit" ? "Редактор" : t === "split" ? "Рядом" : "Просмотр"}
          </button>
        ))}
        <span className="ml-auto hidden text-[11px] text-zinc-500 sm:inline">
          {words} {words % 10 === 1 && words % 100 !== 11 ? "слово" : [2, 3, 4].includes(words % 10) && ![12, 13, 14].includes(words % 100) ? "слова" : "слов"}
          {" · "}~{Math.max(1, Math.round(words / 180))} мин чтения
        </span>
      </div>
      <button className="document-tools-toggle" type="button" aria-expanded={tools} onClick={() => setTools(!tools)}><PenLine size={12} /><span>Помощь редактора</span><small>{partial ? "Выделен фрагмент" : "Весь документ"}</small><span aria-hidden="true">{tools ? "−" : "+"}</span></button>

      {tools && <div role="group" aria-label="Изменить текст" className="document-tools flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2">
        <span className="mr-0.5 text-[11px] text-zinc-500">
          {partial ? `Выделенное (${end - start} симв.):` : "Весь текст:"}
        </span>
        {ACTIONS.map((a) => (
          <button
            key={a.task}
            type="button"
            disabled={busy !== null || !current.trim()}
            onClick={() => void run(a.task)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${
              busy === a.task
                ? "border-violet-300/50 bg-violet-500/20 text-violet-100"
                : "border-white/10 text-zinc-300 hover:border-violet-300/40 hover:text-zinc-50"
            }`}
          >
            {busy === a.task ? <LoaderCircle className="size-3 animate-spin" /> : <span aria-hidden="true">{a.emoji}</span>}
            {a.label}
          </button>
        ))}
      </div>}

      <div className={`document-content document-content--${tab}`}>
      {tab !== "preview" && <section className="document-editor-pane" aria-label="Редактор текста">
        <div className="document-pane-label"><PenLine size={11} />Редактор<span>Markdown</span></div>
        <textarea
          ref={editor}
          value={current}
          readOnly={busy !== null}
          onChange={(e) => type(e.target.value)}
          onSelect={(e) => setSelection([e.currentTarget.selectionStart, e.currentTarget.selectionEnd])}
          spellCheck
          aria-label="Текст документа"
          className={`document-editor min-h-0 flex-1 resize-none bg-transparent px-5 py-4 text-[15px] leading-7 text-zinc-100 outline-none md:px-8 ${
            busy ? "opacity-60" : ""
          }`}
        />
      </section>}
      {tab !== "edit" && <section className="document-preview-pane" aria-label="Просмотр документа">
        <div className="document-pane-label"><Eye size={11} />Предпросмотр<span>{words} слов</span></div>
        <div className="document-preview-scroll"><div className="document-paper">
          <Markdown text={current} />
        </div></div>
      </section>}
      </div>

      {status && (
        <div className={`flex items-center gap-2 border-t border-white/10 px-3 py-2 text-xs ${status.error ? "text-red-300" : "text-zinc-300"}`}>
          {!status.error && <Check className="size-3.5 shrink-0 text-violet-300" />}
          <span className="min-w-0 flex-1">{status.text}</span>
          <button type="button" aria-label="Скрыть" onClick={() => setStatus(null)} className="text-zinc-500 hover:text-zinc-200">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <form
        className="flex items-center gap-2 border-t border-white/10 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ask.trim()) void run("custom", ask.trim());
        }}
      >
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          maxLength={1000}
          placeholder={
            busy ? "MARYX правит текст…" : partial ? "Что сделать с выделенным? Например: добавь пример" : "Что изменить? Например: добавь вывод в конце"
          }
          aria-label="Что изменить в документе"
          disabled={busy !== null}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-300/40 disabled:opacity-60"
        />
        <button type="submit" disabled={busy !== null || !ask.trim()} aria-label="Изменить документ" className="maryx-button rounded-xl p-2.5 disabled:opacity-50">
          {busy === "custom" ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </form>
    </aside>
  );
}
