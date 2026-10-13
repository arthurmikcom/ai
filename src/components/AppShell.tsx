"use client";

import {
  Bot,
  Clapperboard,
  Image as ImageIcon,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { relativeTime } from "@/lib/client/util";
import { useApp } from "./AppState";

const NAV = [
  { href: "/", label: "Чат", icon: MessageSquare },
  { href: "/images", label: "Изображения", icon: ImageIcon },
  { href: "/video", label: "Видео", icon: Clapperboard },
  { href: "/assistants", label: "Мои ассистенты", icon: Bot },
  { href: "/settings", label: "Настройки", icon: Settings },
];

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const app = useApp();
  const pathname = usePathname();
  const router = useRouter();

  const goToChat = (id: string | null) => {
    app.openChat(id);
    router.push("/");
    onNavigate();
  };

  // Date headers ("Сегодня", "Вчера"…) above the first chat of each group.
  const rows = app.chats.map((chat, i) => {
    const group = relativeTime(chat.updatedAt);
    const prev = i > 0 ? relativeTime(app.chats[i - 1].updatedAt) : null;
    return { chat, header: group !== prev ? group : null };
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
          <Sparkles className="size-4 text-white" />
        </div>
        <span className="text-lg font-semibold tracking-tight text-zinc-100">Nexus AI</span>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => goToChat(null)}
          className="flex w-full items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-100 transition hover:bg-white/5"
        >
          <MessageSquarePlus className="size-4" /> Новый чат
        </button>
      </div>

      <nav className="mt-3 space-y-0.5 px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                active ? "bg-white/10 text-zinc-100" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Icon className="size-4" /> {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {rows.map(({ chat, header }) => {
          const active = pathname === "/" && app.activeChat?.id === chat.id;
          return (
            <div key={chat.id}>
              {header && (
                <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
                  {header}
                </div>
              )}
              <div
                className={`group flex items-center rounded-xl transition ${
                  active ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <button
                  type="button"
                  onClick={() => goToChat(chat.id)}
                  className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm text-zinc-300"
                >
                  {app.isStreaming(chat.id) && (
                    <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-violet-400 align-middle" />
                  )}
                  {chat.title}
                </button>
                <button
                  type="button"
                  title="Удалить чат"
                  onClick={() => {
                    if (confirm(`Удалить чат «${chat.title}»?`)) app.deleteChat(chat.id);
                  }}
                  className="mr-1 rounded-lg p-1.5 text-zinc-500 opacity-100 hover:text-red-300 md:opacity-0 md:group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-zinc-950 text-zinc-100">
      <aside className="hidden w-72 shrink-0 border-r border-white/5 bg-zinc-900/60 md:block">
        <Sidebar onNavigate={() => {}} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-white/10 bg-zinc-900">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 text-zinc-400 hover:text-zinc-100"
            >
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <main className="relative min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute left-3 top-3 z-30 rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 md:hidden"
          title="Меню"
        >
          <Menu className="size-5" />
        </button>
        {children}
      </main>
    </div>
  );
}
