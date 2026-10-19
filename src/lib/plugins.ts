// «Плагины»: what MARYX can look up for an answer from free services with no
// keys (the browser shows this list; server/plugins.ts does the looking up).

export type PluginId = "weather" | "currency" | "crypto" | "wikipedia" | "news" | "github" | "holidays" | "arxiv" | "time";

export type PluginCategory = "everyday" | "finance" | "knowledge" | "dev";

export interface PluginInfo {
  id: PluginId;
  name: string;
  /** One line, under the name. */
  description: string;
  category: PluginCategory;
  /** What to ask in the chat. */
  examples: string[];
  /** Where the data comes from (named in the answer). */
  source: { name: string; url: string };
}

export const PLUGIN_CATEGORIES: { id: PluginCategory; label: string }[] = [
  { id: "everyday", label: "На каждый день" },
  { id: "finance", label: "Финансы" },
  { id: "knowledge", label: "Знания и наука" },
  { id: "dev", label: "Для разработчиков" },
];

export const PLUGINS: PluginInfo[] = [
  {
    id: "weather",
    name: "Погода",
    description: "Прогноз на сегодня и неделю в любом городе",
    category: "everyday",
    examples: ["Какая погода в Париже завтра?", "Нужен ли зонт в Лондоне на выходных?"],
    source: { name: "MET Norway (yr.no)", url: "https://www.yr.no/" },
  },
  {
    id: "news",
    name: "Новости",
    description: "Свежие новости со всего мира по любой теме",
    category: "everyday",
    examples: ["Что нового в мире ИИ?", "Последние новости о космосе"],
    source: { name: "GDELT — новости мира", url: "https://www.gdeltproject.org/" },
  },
  {
    id: "time",
    name: "Мировое время",
    description: "Который час в любом городе и разница во времени",
    category: "everyday",
    examples: ["Который час в Токио?", "Какая разница во времени между Дубаем и Нью-Йорком?"],
    source: { name: "База часовых поясов IANA", url: "https://www.iana.org/time-zones" },
  },
  {
    id: "holidays",
    name: "Праздники",
    description: "Государственные праздники и выходные любой страны",
    category: "everyday",
    examples: ["Какие праздники в мае в Германии?", "Когда следующий выходной в ОАЭ?"],
    source: { name: "Nager.Date", url: "https://date.nager.at/" },
  },
  {
    id: "currency",
    name: "Курсы валют",
    description: "Курсы 160+ валют мира и пересчёт сумм",
    category: "finance",
    examples: ["Какой курс евро к доллару?", "Сколько будет 500 евро в японских иенах?"],
    source: { name: "ExchangeRate-API", url: "https://www.exchangerate-api.com/" },
  },
  {
    id: "crypto",
    name: "Криптовалюты",
    description: "Цены биткоина, эфира и других монет за сутки",
    category: "finance",
    examples: ["Сколько стоит биткоин?", "Как изменился курс TON за сутки?"],
    source: { name: "CoinGecko", url: "https://www.coingecko.com/" },
  },
  {
    id: "wikipedia",
    name: "Википедия",
    description: "Проверенные факты о людях, местах и событиях",
    category: "knowledge",
    examples: ["Кто такой Никола Тесла?", "Расскажи про историю Казани"],
    source: { name: "Wikipedia", url: "https://www.wikipedia.org/" },
  },
  {
    id: "arxiv",
    name: "Научные статьи",
    description: "Свежие исследования с arXiv",
    category: "knowledge",
    examples: ["Найди научные статьи про квантовые компьютеры", "Новые исследования о генерации видео"],
    source: { name: "arXiv", url: "https://arxiv.org/" },
  },
  {
    id: "github",
    name: "GitHub",
    description: "Найти открытый проект, звёзды, последние версии",
    category: "dev",
    examples: ["Найди на GitHub бесплатный аналог Photoshop", "Какая последняя версия ComfyUI на GitHub?"],
    source: { name: "GitHub", url: "https://github.com/" },
  },
];

/** On for everyone until they change it: the most useful ones. */
export const DEFAULT_PLUGINS: PluginId[] = ["weather", "news", "time", "currency", "crypto", "wikipedia"];

export function isPluginId(id: unknown): id is PluginId {
  return typeof id === "string" && PLUGINS.some((p) => p.id === id);
}

export function pluginName(id: PluginId): string {
  return PLUGINS.find((p) => p.id === id)?.name ?? id;
}
