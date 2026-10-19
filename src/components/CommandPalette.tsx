"use client";

import {
  Bot,
  ArrowUpRight,
  Clapperboard,
  CornerDownLeft,
  Gem,
  Image as ImageIcon,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Moon,
  Palette,
  Search,
  Settings,
  Sun,
  Type,
  UserRound,
  X,
  type MaryxIconType,
} from "@/components/MaryxIcons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ACCENTS, TEXT_SIZES } from "@/lib/appearance";
import { api } from "@/lib/client/api";
import { useAppearance } from "@/lib/client/appearance";
import { relativeTime } from "@/lib/client/util";
import { useApp } from "./AppState";

interface Command {
  id: string;
  group: string;
  label: string;
  /** Other words it's found by. */
  keywords?: string;
  hint?: string;
  icon: MaryxIconType;
  /** A colour dot instead of the icon (accents). */
  swatch?: string;
  run: () => void;
}

/** How many chats show before anything is typed. */
const RECENT_CHATS = 6;

/**
 * The command palette (Ctrl/⌘+K): find a chat (by its title or what was said
 * in it), go to a section, start something new or change the look — from the
 * keyboard, in a couple of keystrokes.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const [, setLook] = useAppearance();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [category, setCategory] = useState("Всё");
  // Chats whose messages contain the words come from the server.
  const [found, setFound] = useState<{ query: string; ids: string[] } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(typeof document === "undefined" ? null : document.activeElement as HTMLElement);
  const q = query.trim().toLowerCase();

  useEffect(() => {
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      api<{ ids: string[] }>(`/api/chats?q=${encodeURIComponent(q)}`).then(
        (r) => setFound({ query: q, ids: r.ids }),
        () => {},
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const go = (href: string) => () => router.push(href);
  const commands: Command[] = [
    {
      id: "new",
      group: "Действия",
      label: "Новый чат",
      keywords: "написать спросить",
      icon: MessageSquarePlus,
      run: () => {
        app.openChat(null);
        router.push("/");
      },
    },
    { id: "draw", group: "Действия", label: "Создать картинку", keywords: "нарисовать изображение фото", icon: ImageIcon, run: go("/images") },
    { id: "film", group: "Действия", label: "Создать видео", keywords: "снять оживить ролик", icon: Clapperboard, run: go("/video") },
    { id: "character", group: "Действия", label: "Фотосессия с моим персонажем", keywords: "персонаж фото себя", icon: UserRound, run: go("/images") },
    { id: "assistants", group: "Разделы", label: "Мои ассистенты", keywords: "боты", icon: Bot, run: go("/assistants") },
    { id: "pricing", group: "Разделы", label: "Тарифы и кредиты", keywords: "pro оплата подписка", icon: Gem, run: go("/pricing") },
    { id: "settings", group: "Разделы", label: "Настройки", keywords: "аккаунт профиль память", icon: Settings, run: go("/settings") },
    ...app.assistants.map(a => ({ id: `assistant-${a.id}`, group: "Ассистенты", label: a.name, keywords: a.description, icon: Bot, run: () => { app.startChatWith(a.id); router.push("/"); } })),
    { id: "dark", group: "Оформление", label: "Тёмная тема", keywords: "ночь тема", icon: Moon, run: () => setLook({ theme: "dark" }) },
    { id: "light", group: "Оформление", label: "Светлая тема", keywords: "день тема", icon: Sun, run: () => setLook({ theme: "light" }) },
    { id: "system", group: "Оформление", label: "Тема как в системе", keywords: "авто тема", icon: Monitor, run: () => setLook({ theme: "system" }) },
    ...ACCENTS.map((a) => ({
      id: `accent-${a.id}`,
      group: "Оформление",
      label: `Цвет: ${a.label.toLowerCase()}`,
      keywords: "цвет акцент оформление",
      icon: Palette,
      swatch: a.color,
      run: () => setLook({ accent: a.id }),
    })),
    ...TEXT_SIZES.map((t) => ({
      id: `text-${t.id}`,
      group: "Оформление",
      label: `Текст: ${t.label.toLowerCase()}`,
      keywords: "размер шрифт текст",
      icon: Type,
      run: () => setLook({ text: t.id }),
    })),
  ];

  const inMessages = found && found.query === q ? new Set(found.ids) : null;
  const chats = app.chats
    .filter((c) => !q || c.title.toLowerCase().includes(q) || inMessages?.has(c.id))
    .slice(0, q ? 20 : RECENT_CHATS)
    .map(
      (c): Command => ({
        id: `chat-${c.id}`,
        group: q ? "Чаты" : "Недавние чаты",
        label: c.title,
        hint: relativeTime(c.updatedAt),
        icon: MessageSquare,
        run: () => {
          app.openChat(c.id);
          router.push("/");
        },
      }),
    );
  const matches = (c: Command) => !q || `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(q);
  // Typing looks in chats first; before that, actions lead.
  const results = q ? [...chats, ...commands.filter(matches)] : [...commands.filter((c) => c.group !== "Оформление"), ...chats, ...commands.filter((c) => c.group === "Оформление")];
  const shown = results.filter(c => category === "Всё" || (category === "Диалоги" ? c.id.startsWith("chat-") : category === "Ассистенты" ? c.group === "Ассистенты" : category === "Оформление" ? c.group === "Оформление" : c.group === "Действия" || c.group === "Разделы"));
  const current = Math.max(0, Math.min(active, shown.length - 1));

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  // The highlighted row stays in view while moving with the arrows.
  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  useEffect(() => () => {
    if (previousFocus.current?.isConnected) previousFocus.current.focus();
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-3 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Поиск и команды"
        className="command-workspace palette-enter flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onClose(); }
          if (e.key !== "Tab") return;
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled),a[href],[tabindex="0"]') ?? []);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}
      >
        <div className="command-heading"><span><Palette size={13} />Центр управления</span><small>Всё нужное — в паре нажатий</small></div>
        <div className="flex items-center gap-3 border-b border-white/10 px-4">
          <Search className="size-4 shrink-0 text-violet-300" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(Math.max(0, Math.min(current + 1, shown.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(Math.max(current - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(shown[current]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[current] ? `palette-${shown[current].id}` : undefined}
            placeholder="Найти чат или команду…"
            aria-label="Найти чат или команду"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <kbd className="hidden rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-500 sm:block">Esc</kbd>
          <button type="button" className="workspace-icon-button" aria-label="Закрыть поиск" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="workspace-filters command-filters" role="group" aria-label="Категории поиска">{["Всё", "Диалоги", "Инструменты", "Ассистенты", "Оформление"].map(c => <button key={c} type="button" aria-pressed={category === c} onClick={() => { setCategory(c); setActive(0); }}>{c}</button>)}</div>
        <div ref={list} id="palette-list" role="listbox" aria-label="Результаты" className="min-h-0 flex-1 overflow-y-auto p-2">
          {shown.length === 0 && <div className="px-3 py-8 text-center text-sm text-zinc-500">Ничего не нашлось</div>}
          {shown.map((c, i) => (
            <div key={c.id}>
              {(i === 0 || shown[i - 1].group !== c.group) && (
                <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{c.group}</div>
              )}
              <div
                id={`palette-${c.id}`}
                role="option"
                aria-selected={i === current}
                data-index={i}
                onMouseMove={() => i !== current && setActive(i)}
                onClick={() => run(c)}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
                  i === current ? "bg-violet-500/15 text-zinc-50" : "text-zinc-300"
                }`}
              >
                {c.swatch ? (
                  <span className="size-4 shrink-0 rounded-full" style={{ background: c.swatch }} />
                ) : (
                  <c.icon className={`size-4 shrink-0 ${i === current ? "text-violet-300" : "text-zinc-500"}`} />
                )}
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="shrink-0 text-xs text-zinc-500">{c.hint}</span>}
                {i === current ? <CornerDownLeft className="size-3.5 shrink-0 text-zinc-500" /> : <ArrowUpRight className="size-3.5 shrink-0 text-zinc-600" />}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2 text-[11px] text-zinc-500">
          <span>↑↓ выбрать</span>
          <span>Enter — открыть</span>
          <span className="ml-auto hidden sm:inline">Ctrl+K или ⌘K — в любом месте</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
