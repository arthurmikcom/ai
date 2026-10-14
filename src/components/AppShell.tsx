"use client";

import {
  Bot,
  ArrowUpRight,
  Clapperboard,
  Gem,
  Image as ImageIcon,
  LogOut,
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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { relativeTime } from "@/lib/client/util";
import { useApp } from "./AppState";
import { BrandMark } from "./Design";

const NAV = [
  { href: "/", label: "Чат", icon: MessageSquare },
  { href: "/images", label: "Изображения", icon: ImageIcon },
  { href: "/video", label: "Видео", icon: Clapperboard },
  { href: "/assistants", label: "Мои ассистенты", icon: Bot },
  { href: "/pricing", label: "Тарифы", icon: Gem },
  { href: "/settings", label: "Настройки", icon: Settings },
];

function UserMenu() {
  const { me, signOut } = useApp();
  if (!me) return null;
  const { used, limit } = me.usage.chat;
  return (
    <div className="border-t border-white/5 px-3 py-4">
      <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-sm font-medium text-violet-200">
          {(me.user.name || me.user.email).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm text-zinc-200">
            <span className="truncate">{me.user.name || me.user.email}</span>
            {me.plan.id === "pro" && (
              <span className="shrink-0 rounded-md bg-violet-500/20 px-1.5 py-px text-[10px] font-semibold uppercase text-violet-200">
                Pro
              </span>
            )}
          </div>
          <div className="truncate text-xs text-zinc-500">
            {limit === null ? "Без лимитов" : `${used} / ${limit} сообщений сегодня`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          title="Выйти"
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

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
      <div className="flex items-center gap-3 px-6 pb-7 pt-8">
        <BrandMark />
        <span className="brand-wordmark">Nexus <span>AI</span></span>
      </div>

      <div className="px-5">
        <button
          type="button"
          onClick={() => goToChat(null)}
          className="nexus-button flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[13px]"
        >
          <MessageSquarePlus className="size-4" /> Новый чат
        </button>
      </div>

      {/* Navigation, history and the upgrade card scroll together, so on short
          screens the chat list and the user menu below never get squeezed out. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="section-label mb-2 mt-7 px-6">Пространство</div>
      <nav aria-label="Основная навигация" className="space-y-1 px-5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`sidebar-nav flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] ${
                active ? "is-active" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <Icon className="size-4" /> {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 flex-1 px-5 pb-4">
        <div className="section-label px-1">Ваши диалоги</div>
        {rows.length === 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-4 text-[11px] leading-5 text-zinc-500">
            Здесь будет история ваших идей.<br />Начните с нового диалога.
          </div>
        )}
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
      {app.me?.plan.id === "free" && (
        <Link href="/pricing" onClick={onNavigate} className="sidebar-upgrade mx-5 mb-5 rounded-2xl border border-violet-300/15 p-4 hover:border-violet-300/35">
          <div className="flex items-center justify-between text-xs font-medium text-violet-200">
            <span className="flex items-center gap-2"><Sparkles className="size-3.5" /> Nexus Pro</span>
            <ArrowUpRight className="size-4" />
          </div>
          <p className="mt-2 text-[11px] leading-5 text-zinc-400">Больше места для больших идей. Откройте возможности Pro.</p>
        </Link>
      )}
      </div>
      <UserMenu />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(menu.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
    ) ?? []);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open]);

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex h-dvh overflow-hidden bg-zinc-950 text-zinc-100">
      <aside className="app-sidebar hidden shrink-0 border-r border-white/5 md:block">
        <Sidebar onNavigate={() => {}} />
      </aside>

      {open && (
        <div ref={menu} className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside role="dialog" aria-modal="true" aria-label="Навигация" className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-white/10 bg-zinc-950">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Закрыть меню"
              className="absolute right-3 top-4 rounded-lg p-1.5 text-zinc-400 hover:text-zinc-100"
            >
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <main className="app-main relative min-w-0 flex-1">
        <header className="mobile-bar">
          <div className="flex items-center gap-2.5"><BrandMark className="!size-7 !rounded-lg" /><span className="brand-wordmark !text-base">Nexus <span>AI</span></span></div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-white/10 p-2 text-zinc-300 hover:bg-white/5"
          title="Меню"
          aria-label="Меню"
          aria-expanded={open}
        >
          <Menu className="size-5" />
        </button>
        </header>
        {children}
      </main>
    </div>
  );
}
