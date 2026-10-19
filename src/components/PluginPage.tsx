"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { askInNewChat, usePlugins } from "@/lib/client/plugins";
import { PLUGIN_CATEGORIES, pluginInfo, type PluginId } from "@/lib/plugins";
import { useApp } from "./AppState";
import { ArrowRight, Check, ChevronRight, LoaderCircle, MessageSquarePlus, Plus, X } from "./MaryxIcons";
import { PluginIcon } from "./PluginIcon";

/** One plugin's page (like ChatGPT's): what to ask, what it does, where its data comes from. */
export function PluginPage({ id }: { id: PluginId }) {
  const app = useApp();
  const router = useRouter();
  const { installed, busy, error, toggle, on } = usePlugins(Boolean(app.me));
  const plugin = pluginInfo(id)!;
  const category = PLUGIN_CATEGORIES.find((c) => c.id === plugin.category)?.label ?? "";
  const ready = installed !== null && busy !== id;

  /** A new chat with the question; the plugin is turned on first if it was off. */
  const tryIt = async (text: string) => {
    if (!on(id) && !(await toggle(id, true))) return;
    askInNewChat(text);
    app.startChatWith(null);
    router.push("/");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-content plugin-page">
        <nav className="plugin-crumbs" aria-label="Путь">
          <Link href="/plugins">Плагины</Link>
          <ChevronRight size={14} aria-hidden="true" />
          <span aria-current="page">{plugin.name}</span>
        </nav>

        <header className="plugin-head">
          <PluginIcon id={id} size={64} />
          <div className="plugin-head-name">
            <h1>{plugin.name}</h1>
            <p>
              От MARYX Ai · данные: {plugin.source.name}
            </p>
          </div>
          <div className="plugin-head-actions">
            <button
              type="button"
              className="plugin-manage"
              data-on={on(id) || undefined}
              disabled={!ready}
              onClick={() => void toggle(id, !on(id))}
            >
              {!ready ? <LoaderCircle className="size-4 animate-spin" /> : on(id) ? <Check size={16} /> : <Plus size={16} />}
              {on(id) ? "Подключён" : "Подключить"}
            </button>
            <button type="button" className="plugin-try" disabled={!ready} onClick={() => void tryIt(plugin.examples[0])}>
              <MessageSquarePlus size={16} /> Попробовать в чате
            </button>
          </div>
        </header>

        {error && (
          <p role="alert" className="vs-error">
            {error}
          </p>
        )}

        <section className="plugin-showcase" data-plugin={id} aria-label="Спросите в чате">
          {plugin.examples.map((text) => (
            <button key={text} type="button" className="plugin-prompt" disabled={!ready} onClick={() => void tryIt(text)}>
              <span>
                <span className="plugin-prompt-chip">
                  <PluginIcon id={id} size={16} />
                  {plugin.name}
                </span>{" "}
                {text}
              </span>
              <span className="plugin-prompt-go" aria-hidden="true">
                <ArrowRight size={15} />
              </span>
            </button>
          ))}
        </section>

        <p className="plugin-about">{plugin.about}</p>

        <section className="plugin-section" aria-label="Что умеет">
          <h2>
            Что умеет <span>{plugin.features.length}</span>
          </h2>
          <ul className="plugin-features">
            {plugin.features.map((f) => (
              <li key={f.title}>
                <PluginIcon id={id} size={34} />
                <div>
                  <strong>{f.title}</strong>
                  <small>{f.text}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="plugin-section" aria-label="Информация">
          <h2>Информация</h2>
          <dl className="plugin-info">
            <div>
              <dt>Возможности</dt>
              <dd>Чтение свежих данных · только для ответов MARYX</dd>
            </div>
            <div>
              <dt>Разработчик</dt>
              <dd>MARYX Ai</dd>
            </div>
            <div>
              <dt>Источник данных</dt>
              <dd>
                <a href={plugin.source.url} target="_blank" rel="noreferrer">
                  {plugin.source.name}
                </a>
              </dd>
            </div>
            <div>
              <dt>Категория</dt>
              <dd>{category}</dd>
            </div>
            <div>
              <dt>Стоимость</dt>
              <dd>Бесплатно, без ключей и регистрации в сервисе</dd>
            </div>
            <div>
              <dt>Что отправляется</dt>
              <dd>Только то, что нужно найти (город, валюту, тему). Ваш чат и данные остаются у MARYX.</dd>
            </div>
            <div>
              <dt>Версия</dt>
              <dd>1.0</dd>
            </div>
            {plugin.source.terms && (
              <div>
                <dt>Условия источника</dt>
                <dd>
                  <a href={plugin.source.terms} target="_blank" rel="noreferrer">
                    Посмотреть
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </section>

        {on(id) && (
          <button type="button" className="plugin-remove" disabled={!ready} onClick={() => void toggle(id, false)}>
            <X size={15} /> Отключить плагин
          </button>
        )}
      </div>
    </div>
  );
}
