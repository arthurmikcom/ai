"use client";

import Link from "next/link";
import { useState } from "react";
import { usePlugins } from "@/lib/client/plugins";
import { PLUGIN_CATEGORIES, PLUGINS, type PluginInfo } from "@/lib/plugins";
import { useApp } from "./AppState";
import { PageHeading } from "./Design";
import { Check, LoaderCircle, Plus, Search } from "./MaryxIcons";
import { PluginIcon } from "./PluginIcon";

/**
 * «Плагины» (like ChatGPT's): free services MARYX looks things up in for an
 * answer — the weather, rates, news, Wikipedia, GitHub… No keys: turn one on,
 * and MARYX uses it by itself when a question calls for it.
 */
export function PluginsView() {
  const app = useApp();
  const { installed, busy, error, toggle, on } = usePlugins(Boolean(app.me));
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = PLUGINS.filter((p) => !q || [p.name, p.description, p.about, ...p.examples].some((t) => t.toLowerCase().includes(q)));

  const row = (p: PluginInfo) => (
    <li key={p.id} className="plugin-row">
      <Link href={`/plugins/${p.id}`} className="plugin-row-main">
        <PluginIcon id={p.id} />
        <span>
          <strong>{p.name}</strong>
          <small>{p.description}</small>
        </span>
      </Link>
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
          description="Подключите плагин — и MARYX сам заглянет в него, когда вопрос этого требует: погода, курсы и акции, новости, отели и билеты, музыка, спорт, научные исследования. Бесплатно и без ключей."
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
                    <Link href={`/plugins/${p.id}`} title={p.name} aria-label={p.name}>
                      <PluginIcon id={p.id} size={44} />
                    </Link>
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
          Плагины работают в ответах MARYX: спросите в чате как обычно — «какая погода в Париже?», «отель в Риме на выходные», «счёт матча
          Реала», «что говорят исследования о кофе» — и MARYX возьмёт свежие данные и назовёт источник. Если в вопросе нет такой темы,
          плагины не тратят ничего.
        </p>
      </div>
    </div>
  );
}
