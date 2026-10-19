"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { api } from "@/lib/client/api";
import { PLUGIN_CATEGORIES, PLUGINS, type PluginId, type PluginInfo } from "@/lib/plugins";
import { useApp } from "./AppState";
import { PageHeading } from "./Design";
import {
  ArrowUpRight,
  Banknote,
  CalendarDays,
  Check,
  Clock,
  Code2,
  Coins,
  FileText,
  GraduationCap,
  LoaderCircle,
  Plus,
  Search,
  Sun,
  Telescope,
  X,
  type MaryxIconProps,
} from "./MaryxIcons";

const ICONS: Record<PluginId, ComponentType<MaryxIconProps>> = {
  weather: Sun,
  news: FileText,
  time: Clock,
  holidays: CalendarDays,
  currency: Banknote,
  crypto: Coins,
  wikipedia: GraduationCap,
  arxiv: Telescope,
  github: Code2,
};

/** The app-store tile: the plugin's own colours. */
function PluginIcon({ id, size = 38 }: { id: PluginId; size?: number }) {
  const Icon = ICONS[id];
  return (
    <span className="plugin-icon" data-plugin={id} style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.55)} />
    </span>
  );
}

/**
 * «Плагины» (like ChatGPT's): free services MARYX looks things up in for an
 * answer — the weather, rates, news, Wikipedia, GitHub… No keys: turn one on,
 * and MARYX uses it by itself when a question calls for it.
 */
export function PluginsView() {
  const app = useApp();
  const router = useRouter();
  const [installed, setInstalled] = useState<PluginId[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<PluginInfo | null>(null);
  const [busy, setBusy] = useState<PluginId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!app.me) return;
    let alive = true;
    api<{ installed: PluginId[] }>("/api/plugins").then(
      (r) => alive && setInstalled(r.installed),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [app.me]);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const toggle = async (id: PluginId, on: boolean) => {
    setBusy(id);
    setError(null);
    setInstalled((list) => (list ? (on ? [...list, id] : list.filter((p) => p !== id)) : list));
    try {
      setInstalled((await api<{ installed: PluginId[] }>("/api/plugins", { method: "PUT", body: JSON.stringify({ id, on }) })).installed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInstalled((list) => (list ? (on ? list.filter((p) => p !== id) : [...list, id]) : list));
    }
    setBusy(null);
  };

  /** A new chat with the example asked. */
  const tryIt = (text: string) => {
    try {
      sessionStorage.setItem("maryx:ask", text);
    } catch {
      // without storage the chat just opens
    }
    app.startChatWith(null);
    router.push("/");
  };

  const q = query.trim().toLowerCase();
  const shown = PLUGINS.filter((p) => !q || [p.name, p.description, ...p.examples].some((t) => t.toLowerCase().includes(q)));
  const on = (id: PluginId) => Boolean(installed?.includes(id));

  const row = (p: PluginInfo) => (
    <li key={p.id} className="plugin-row">
      <button type="button" className="plugin-row-main" onClick={() => setOpen(p)}>
        <PluginIcon id={p.id} />
        <span>
          <strong>{p.name}</strong>
          <small>{p.description}</small>
        </span>
      </button>
      <button
        type="button"
        className="plugin-toggle"
        data-on={on(p.id) || undefined}
        disabled={!installed || busy === p.id}
        onClick={() => void toggle(p.id, !on(p.id))}
        aria-label={on(p.id) ? `Отключить «${p.name}»` : `Подключить «${p.name}»`}
        title={on(p.id) ? "Подключён — нажмите, чтобы отключить" : "Подключить"}
      >
        {busy === p.id ? <LoaderCircle className="size-4 animate-spin" /> : on(p.id) ? <Check size={16} /> : <Plus size={16} />}
      </button>
    </li>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-content plugins-page">
        <PageHeading
          number="09"
          eyebrow="Свежие данные прямо в ответе"
          title="Плагины"
          description="Подключите плагин — и MARYX сам заглянет в него, когда вопрос этого требует: погода, курсы, новости, Википедия, GitHub. Бесплатно и без ключей."
        />

        <label className="plugins-search">
          <Search size={17} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск плагинов" aria-label="Поиск плагинов" />
        </label>

        {error && (
          <p role="alert" className="vs-error">
            {error}
          </p>
        )}

        {!q && (
          <section className="plugins-installed" aria-label="Подключённые">
            <h2>Подключённые</h2>
            {installed === null ? (
              <LoaderCircle className="size-5 animate-spin text-zinc-500" />
            ) : installed.length ? (
              <ul>
                {PLUGINS.filter((p) => installed.includes(p.id)).map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setOpen(p)} title={p.name} aria-label={p.name}>
                      <PluginIcon id={p.id} size={44} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="plugins-empty">Ни одного — подключите нужные ниже.</p>
            )}
          </section>
        )}

        {PLUGIN_CATEGORIES.map((c) => {
          const items = shown.filter((p) => p.category === c.id);
          if (!items.length) return null;
          return (
            <section key={c.id} className="plugins-category" aria-label={c.label}>
              <h2>{c.label}</h2>
              <ul>{items.map(row)}</ul>
            </section>
          );
        })}
        {!shown.length && <p className="plugins-empty">Ничего не нашлось по запросу «{query}».</p>}

        <p className="plugins-note">
          Плагины работают в ответах MARYX: спросите в чате как обычно — «какая погода в Казани?», «курс доллара», «что нового в ИИ» — и
          MARYX возьмёт свежие данные и назовёт источник. Если в вопросе нет такой темы, плагины не тратят ничего.
        </p>
      </div>

      {open && (
        <div className="plugin-dialog-backdrop" onClick={() => setOpen(null)}>
          <div className="plugin-dialog" role="dialog" aria-modal="true" aria-label={open.name} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="plugin-dialog-close" onClick={() => setOpen(null)} aria-label="Закрыть">
              <X size={18} />
            </button>
            <div className="plugin-dialog-head">
              <PluginIcon id={open.id} size={56} />
              <div>
                <h2>{open.name}</h2>
                <p>{open.description}</p>
              </div>
            </div>
            <h3>Спросите в чате</h3>
            <ul className="plugin-examples">
              {open.examples.map((e) => (
                <li key={e}>
                  <button type="button" onClick={() => tryIt(e)} disabled={!on(open.id)} title={on(open.id) ? "Спросить в новом чате" : "Сначала подключите плагин"}>
                    «{e}» <ArrowUpRight size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="plugin-dialog-source">
              Данные: <a href={open.source.url} target="_blank" rel="noreferrer">{open.source.name}</a>. MARYX отправляет туда только то, что нужно найти (город, валюту, тему) — не ваш
              чат.
            </p>
            <button
              type="button"
              className={on(open.id) ? "vs-reel-button" : "maryx-button vs-reel-button"}
              disabled={!installed || busy === open.id}
              onClick={() => void toggle(open.id, !on(open.id))}
            >
              {on(open.id) ? (
                <>
                  <X size={16} /> Отключить
                </>
              ) : (
                <>
                  <Plus size={16} /> Подключить
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
