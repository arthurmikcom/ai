// «Плагины»: fresh data for an answer from free services with no keys. When a
// message looks like one of the user's plugins can help (weather, a rate,
// news…), a light model fills in what to look up, the plugins look it up, and
// the answer is written from what they found, with the sources named.

import { eq } from "drizzle-orm";
import { DEFAULT_PLUGINS, isPluginId, PLUGINS, pluginName, type PluginId } from "@/lib/plugins";
import type { Source } from "@/lib/types";
import { getDb, schema } from "./db";
import { quickText } from "./maryx";
import { geocode } from "./places";
import type { Meter } from "./spend";

/** The plugins the user has on. */
export async function installedPlugins(userId: string): Promise<PluginId[]> {
  const db = await getDb();
  const [row] = await db.select({ plugins: schema.userPref.plugins }).from(schema.userPref).where(eq(schema.userPref.userId, userId));
  return row?.plugins ? row.plugins.filter(isPluginId) : [...DEFAULT_PLUGINS];
}

/** Turns a plugin on or off; the user's list after it. */
export async function setPlugin(userId: string, id: PluginId, on: boolean): Promise<PluginId[]> {
  const now = await installedPlugins(userId);
  const next = PLUGINS.map((p) => p.id).filter((p) => (p === id ? on : now.includes(p)));
  const db = await getDb();
  await db.insert(schema.userPref).values({ userId, plugins: next }).onConflictDoUpdate({ target: schema.userPref.userId, set: { plugins: next } });
  return next;
}

/** Words that say a plugin may help (only then is a model asked what to look up). */
const HINTS: Record<PluginId, RegExp> = {
  weather: /погод|температур|градус|прогноз|дожд|снег|ветер|ветрен|жар[ак]|холодн|зонт|солнечн|weather|forecast/i,
  currency: /курс|доллар|евро|юан|рубл|валют|тенге|гривн|лир[аы]\b|фунт|иен|обмен|конверт|\b(usd|eur|cny|gbp|kzt|try)\b|exchange rate/i,
  crypto: /биткоин|bitcoin|\bbtc\b|эфир|ethereum|\beth\b|крипт|тонкоин|toncoin|\bton\b|solana|\bsol\b|usdt|тезер|tether|доги?коин|dogecoin|\bxrp\b/i,
  wikipedia: /кто так(ой|ая|ие)|что так(ое|ой|ая)|википеди|wikipedia|биографи|когда родил|когда основ|расскажи (о|об|про)|история (создания|города|страны|компании)/i,
  news: /новост|что случилось|что произошло|последние события|в мире сегодня|\bnews\b|свежие|что нового/i,
  github: /github|гитхаб|гит хаб|репозитор|open[- ]?source|опенсорс|открыт(ый|ом) исходн|исходн(ый|ики|ого) код/i,
  holidays: /праздни|выходн(ые|ой день|ых дн)|нерабоч|\bholiday/i,
  arxiv: /arxiv|научн(ые|ая|ых) стат|исследовани[еяй] (о|об|про|по)|публикаци|\bpapers?\b/i,
  time: /котор(ый|ом) час|сколько (сейчас )?времени|врем(я|ени) (в|сейчас в)|часов(ой|ом) пояс|time in\b|разниц[аеы] во времени/i,
};

const PLAN =
  "Ты выбираешь плагины, из которых MARYX возьмёт свежие данные для ответа. Плагины и их аргументы:\n" +
  '- weather: {"place": "город или место по-русски", "days": число дней прогноза 1–7}\n' +
  '- currency: {"from": ["EUR"], "to": "USD", "amount": сумма или null} — коды валют ISO 4217 (если валюта ответа не названа — USD)\n' +
  '- crypto: {"coins": ["bitcoin"], "vs": ["usd", "rub"]} — id монет CoinGecko (bitcoin, ethereum, the-open-network, solana, tether, ripple, dogecoin…)\n' +
  '- wikipedia: {"query": "о чём статья", "lang": "код языка Википедии — на языке вопроса (ru, en, de…)"}\n' +
  '- news: {"query": "тема новостей по-английски, 2–5 слов (поиск по новостям всего мира)"}\n' +
  '- github: {"repo": "владелец/название"} если назван проект, иначе {"query": "что искать, по-английски"}\n' +
  '- holidays: {"country": "DE" — код страны ISO 3166-1, названной в вопросе, "year": год}\n' +
  '- arxiv: {"query": "тема по-английски"}\n' +
  '- time: {"zones": ["Asia/Tokyo"] — часовые пояса IANA для названных мест}\n' +
  "Из предложенных выбери только те, без которых ответ будет неточным или устаревшим, и заполни аргументы по сообщению " +
  "(предыдущее сообщение — для контекста). Ответь строго JSON без блока кода: " +
  '{"calls": [{"plugin": "weather", "args": {"place": "Казань", "days": 2}}]}. Не больше 3 вызовов. Если ничего не нужно — {"calls": []}.';

/** What a plugin found: text for the model, and where it's from. */
interface Found {
  plugin: PluginId;
  text: string;
  sources: Source[];
}

const UA = { "User-Agent": "MARYX-Ai/1.0 (plugins; +https://github.com/arthurmikcom/ai)" };

/** Tests send every lookup to one stand-in server (PLUGINS_TEST_URL), by the service's host. */
function at(url: string): string {
  const base = process.env.PLUGINS_TEST_URL?.trim();
  if (!base) return url;
  const u = new URL(url);
  return `${base}/${u.host}${u.pathname}${u.search}`;
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(at(url), { headers: { ...UA, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(at(url), { headers: UA, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.text();
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, max = 5) => (Array.isArray(v) ? v.map((x) => str(x, 60)).filter(Boolean).slice(0, max) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const fixed = (n: number, digits = 2) => n.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

// ---------- Погода: MET Norway (yr.no), free with attribution ----------

const SKY: [RegExp, string][] = [
  [/thunder/, "гроза"],
  [/sleet/, "мокрый снег"],
  [/snow/, "снег"],
  [/heavyrain/, "сильный дождь"],
  [/lightrain|drizzle/, "небольшой дождь"],
  [/rain/, "дождь"],
  [/fog/, "туман"],
  [/partlycloudy/, "переменная облачность"],
  [/fair/, "малооблачно"],
  [/clearsky/, "ясно"],
  [/cloudy/, "облачно"],
];
const sky = (code?: string) => (code ? (SKY.find(([re]) => re.test(code))?.[1] ?? code) : "");

interface MetPoint {
  time: string;
  data: {
    instant: { details: { air_temperature?: number; wind_speed?: number; relative_humidity?: number } };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
  };
}

async function weather(args: Record<string, unknown>): Promise<Found | null> {
  const place = str(args.place, 120);
  if (!place) return null;
  const where = await geocode(place);
  if (!where) return { plugin: "weather", text: `Место «${place}» не найдено на карте.`, sources: [] };
  const days = Math.min(7, Math.max(1, Math.round(num(args.days) ?? 3)));
  const lat = where.lat.toFixed(4);
  const lon = where.lon.toFixed(4);
  const forecast = await getJson<{ properties: { timeseries: MetPoint[] } }>(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`);
  const series = forecast.properties.timeseries;
  // Local time, near enough: the place's longitude (the service speaks UTC).
  const offset = Math.round(where.lon / 15) * 3600_000;
  const local = (t: string) => new Date(new Date(t).getTime() + offset);
  const now = series[0];
  const lines = [
    `${where.label}. Сейчас: ${fixed(now.data.instant.details.air_temperature ?? NaN, 0)}°C, ${sky(now.data.next_1_hours?.summary?.symbol_code)}, ветер ${fixed(now.data.instant.details.wind_speed ?? 0, 0)} м/с, влажность ${fixed(now.data.instant.details.relative_humidity ?? 0, 0)}%.`,
  ];
  const byDay = new Map<string, MetPoint[]>();
  for (const p of series) {
    const day = local(p.time).toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  for (const [day, points] of [...byDay].slice(0, days)) {
    const temps = points.map((p) => p.data.instant.details.air_temperature).filter((t): t is number => t !== undefined);
    const midday = points.find((p) => local(p.time).getUTCHours() >= 12) ?? points[0];
    const rain = points.reduce((sum, p) => sum + (p.data.next_1_hours?.details?.precipitation_amount ?? 0), 0);
    const date = new Date(`${day}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    lines.push(
      `${date}: от ${fixed(Math.min(...temps), 0)} до ${fixed(Math.max(...temps), 0)}°C, ${sky((midday.data.next_6_hours ?? midday.data.next_1_hours)?.summary?.symbol_code)}${rain >= 0.2 ? `, осадки ${fixed(rain, 1)} мм` : ""}.`,
    );
  }
  return { plugin: "weather", text: lines.join("\n"), sources: [{ url: `https://www.yr.no/en/forecast/daily-table/${lat},${lon}`, title: `Погода: ${where.label} — MET Norway` }] };
}

// ---------- Курсы: ExchangeRate-API (open access, 160+ currencies, daily) ----------

async function currency(args: Record<string, unknown>): Promise<Found | null> {
  const from = list(args.from).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c));
  const to = (str(args.to, 3) || "USD").toUpperCase();
  const amount = num(args.amount) ?? 1;
  if (!from.length || !/^[A-Z]{3}$/.test(to)) return null;
  const latest = await getJson<{ result: string; time_last_update_utc: string; rates: Record<string, number> }>(`https://open.er-api.com/v6/latest/${to}`);
  if (latest.result !== "success") throw new Error("rates unavailable");
  const lines = [`Курсы валют на ${new Date(latest.time_last_update_utc).toLocaleDateString("ru-RU", { timeZone: "UTC" })}:`];
  for (const code of from) {
    // The rates are per one `to`: one `code` is 1 / rate of them.
    const rate = latest.rates[code];
    lines.push(rate ? `${fixed(amount)} ${code} = ${fixed(amount / rate, 4)} ${to}.` : `${code}: такой валюты нет в курсах.`);
  }
  return { plugin: "currency", text: lines.join("\n"), sources: [{ url: "https://www.exchangerate-api.com", title: "Rates By Exchange Rate API" }] };
}

// ---------- Криптовалюты: CoinGecko ----------

const COINS: Record<string, string> = { btc: "bitcoin", eth: "ethereum", ton: "the-open-network", sol: "solana", usdt: "tether", xrp: "ripple", doge: "dogecoin", bnb: "binancecoin", trx: "tron", ada: "cardano" };

async function cryptoPrices(args: Record<string, unknown>): Promise<Found | null> {
  const coins = list(args.coins).map((c) => COINS[c.toLowerCase()] ?? c.toLowerCase()).filter((c) => /^[a-z0-9-]+$/.test(c));
  const vs = (list(args.vs).length ? list(args.vs) : ["usd", "rub"]).map((c) => c.toLowerCase()).filter((c) => /^[a-z]{3,4}$/.test(c));
  if (!coins.length) return null;
  const prices = await getJson<Record<string, Record<string, number>>>(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(",")}&vs_currencies=${vs.join(",")}&include_24hr_change=true`,
  );
  const lines = coins.map((id) => {
    const p = prices[id];
    if (!p) return `${id}: нет данных.`;
    const parts = vs.filter((v) => p[v] !== undefined).map((v) => `${fixed(p[v], p[v] < 1 ? 6 : 2)} ${v.toUpperCase()}${p[`${v}_24h_change`] !== undefined ? ` (за сутки ${p[`${v}_24h_change`] >= 0 ? "+" : ""}${fixed(p[`${v}_24h_change`], 2)}%)` : ""}`);
    return `${id}: ${parts.join(", ")}.`;
  });
  return { plugin: "crypto", text: `Цены сейчас:\n${lines.join("\n")}`, sources: coins.map((id) => ({ url: `https://www.coingecko.com/en/coins/${id}`, title: `${id} — CoinGecko` })) };
}

// ---------- Википедия ----------

async function wikipedia(args: Record<string, unknown>): Promise<Found | null> {
  const query = str(args.query, 150);
  const lang = typeof args.lang === "string" && /^[a-z]{2,3}$/.test(args.lang) ? args.lang : "en";
  if (!query) return null;
  const search = await getJson<{ pages: { key: string; title: string }[] }>(`https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=1`);
  const page = search.pages[0];
  if (!page) return { plugin: "wikipedia", text: `В Википедии нет статьи по запросу «${query}».`, sources: [] };
  const summary = await getJson<{ title: string; extract: string; content_urls?: { desktop?: { page?: string } } }>(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.key)}`,
  );
  const url = summary.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.key)}`;
  return { plugin: "wikipedia", text: `«${summary.title}» (Wikipedia, ${lang}): ${summary.extract.slice(0, 1800)}`, sources: [{ url, title: `${summary.title} — Wikipedia` }] };
}

// ---------- Новости: Google News RSS ----------

const xmlText = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
const tag = (block: string, name: string) => xmlText(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? "");

async function news(args: Record<string, unknown>): Promise<Found | null> {
  const query = str(args.query, 150);
  if (!query) return null;
  let items: { title: string; link: string; date: string; from: string }[] = [];
  try {
    // GDELT: news from all over the world, in every language.
    const found = await getJson<{ articles?: { url: string; title: string; seendate: string; domain: string }[] }>(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=8&sort=datedesc&timespan=3d`,
    );
    items = (found.articles ?? []).map((a) => ({
      title: a.title,
      link: a.url,
      date: a.seendate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"),
      from: a.domain,
    }));
  } catch (err) {
    console.error("[plugins] GDELT unavailable, Google News instead", err);
  }
  if (!items.length) {
    const rss = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`);
    items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, block]) => ({ title: tag(block, "title"), link: tag(block, "link"), date: tag(block, "pubDate"), from: tag(block, "source") }));
  }
  items = items.filter((i) => i.title && /^https:\/\//.test(i.link)).slice(0, 6);
  if (!items.length) return { plugin: "news", text: `Новостей по запросу «${query}» не нашлось.`, sources: [] };
  const lines = items.map((i, n) => `${n + 1}. ${i.title}${i.from && !i.title.endsWith(i.from) ? ` — ${i.from}` : ""} (${new Date(i.date).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })})`);
  return { plugin: "news", text: `Свежие новости «${query}» (со всего мира):\n${lines.join("\n")}`, sources: items.map((i) => ({ url: i.link, title: i.title })) };
}

// ---------- GitHub ----------

interface Repo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  pushed_at: string;
  license?: { spdx_id?: string } | null;
}

const repoLine = (r: Repo) =>
  `${r.full_name} — ★ ${fixed(r.stargazers_count, 0)}${r.language ? `, ${r.language}` : ""}${r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? `, лицензия ${r.license.spdx_id}` : ""}, обновлён ${new Date(r.pushed_at).toLocaleDateString("ru-RU")}. ${r.description ?? ""}`.trim();

async function github(args: Record<string, unknown>): Promise<Found | null> {
  const headers = { Accept: "application/vnd.github+json" };
  const repo = str(args.repo, 100);
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    const r = await getJson<Repo>(`https://api.github.com/repos/${repo}`, headers);
    const release = await getJson<{ tag_name: string; published_at: string; html_url: string }>(`https://api.github.com/repos/${repo}/releases/latest`, headers).catch(() => null);
    const text = `${repoLine(r)}${release ? `\nПоследний выпуск: ${release.tag_name} от ${new Date(release.published_at).toLocaleDateString("ru-RU")}.` : ""}`;
    return { plugin: "github", text, sources: [{ url: r.html_url, title: `${r.full_name} — GitHub` }, ...(release ? [{ url: release.html_url, title: `${r.full_name} ${release.tag_name}` }] : [])] };
  }
  const query = str(args.query, 150);
  if (!query) return null;
  const found = await getJson<{ items: Repo[] }>(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`, headers);
  if (!found.items.length) return { plugin: "github", text: `На GitHub ничего не нашлось по запросу «${query}».`, sources: [] };
  return {
    plugin: "github",
    text: `Проекты на GitHub по запросу «${query}» (по звёздам):\n${found.items.map((r, i) => `${i + 1}. ${repoLine(r)}`).join("\n")}`,
    sources: found.items.map((r) => ({ url: r.html_url, title: `${r.full_name} — GitHub` })),
  };
}

// ---------- Праздники: Nager.Date ----------

async function holidays(args: Record<string, unknown>): Promise<Found | null> {
  const country = str(args.country, 2).toUpperCase();
  const year = Math.round(num(args.year) ?? new Date().getUTCFullYear());
  if (!/^[A-Z]{2}$/.test(country) || year < 1975 || year > 2100) return null;
  const days = await getJson<{ date: string; localName: string; name: string }[]>(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`);
  const today = new Date().toISOString().slice(0, 10);
  const lines = days.map((d) => `${new Date(`${d.date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short", timeZone: "UTC" })} — ${d.localName}${d.localName !== d.name ? ` (${d.name})` : ""}${d.date >= today && !days.some((x) => x.date >= today && x.date < d.date) ? " ← ближайший" : ""}`);
  return { plugin: "holidays", text: `Государственные праздники (${country}, ${year}):\n${lines.join("\n")}`, sources: [{ url: `https://date.nager.at/PublicHoliday/Country/${country}/${year}`, title: `Праздники ${country} ${year} — Nager.Date` }] };
}

// ---------- Научные статьи: arXiv ----------

async function arxiv(args: Record<string, unknown>): Promise<Found | null> {
  const query = str(args.query, 150);
  if (!query) return null;
  const feed = await getText(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${query}`)}&sortBy=relevance&max_results=5`);
  const entries = [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, block]) => ({
    title: tag(block, "title").replace(/\s+/g, " "),
    summary: tag(block, "summary").replace(/\s+/g, " ").slice(0, 400),
    date: tag(block, "published"),
    url: tag(block, "id").replace(/^http:/, "https:"),
  }));
  if (!entries.length) return { plugin: "arxiv", text: `На arXiv ничего не нашлось по запросу «${query}».`, sources: [] };
  const lines = entries.map((e, i) => `${i + 1}. «${e.title}» (${e.date.slice(0, 10)}): ${e.summary}`);
  return { plugin: "arxiv", text: `Статьи на arXiv по запросу «${query}»:\n${lines.join("\n")}`, sources: entries.map((e) => ({ url: e.url, title: e.title })) };
}

// ---------- Мировое время: часовые пояса (без запросов) ----------

async function time(args: Record<string, unknown>): Promise<Found | null> {
  const zones = list(args.zones).filter((z) => {
    try {
      new Intl.DateTimeFormat("ru-RU", { timeZone: z });
      return true;
    } catch {
      return false;
    }
  });
  if (!zones.length) return null;
  const now = new Date();
  const lines = zones.map((z) => {
    const shown = now.toLocaleString("ru-RU", { timeZone: z, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "shortOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
    return `${z}: ${shown} (${offset.replace("GMT", "UTC")})`;
  });
  return { plugin: "time", text: `Точное время сейчас:\n${lines.join("\n")}`, sources: [] };
}

const RUN: Record<PluginId, (args: Record<string, unknown>) => Promise<Found | null>> = { weather, currency, crypto: cryptoPrices, wikipedia, news, github, holidays, arxiv, time };

/** Plugins whose words are in the message (or the one before it): they may help. */
export function pluginsFor(text: string, installed: PluginId[]): PluginId[] {
  return installed.filter((id) => HINTS[id].test(text));
}

/**
 * Fresh data for the answer from the user's plugins: what to put before the
 * model (with the sources numbered), or null when none of them helps.
 */
export async function pluginContext(
  message: string,
  previous: string | undefined,
  installed: PluginId[],
  meter: Meter,
  progress: (step: string) => void,
): Promise<{ brief: string; sources: Source[]; used: PluginId[] } | null> {
  const candidates = pluginsFor(`${previous ?? ""}\n${message}`, installed);
  if (!candidates.length) return null;
  let calls: { plugin: PluginId; args: Record<string, unknown> }[] = [];
  try {
    const out = await quickText(
      PLAN,
      `Предложенные плагины: ${candidates.join(", ")}.\nСегодня: ${new Date().toISOString().slice(0, 10)}.\n${previous ? `Предыдущее сообщение: ${previous.slice(0, 600)}\n` : ""}Сообщение: ${message.slice(0, 2000)}`,
      12_000,
      meter,
    );
    const parsed = JSON.parse(/\{[\s\S]*\}/.exec(out)?.[0] ?? "{}") as { calls?: { plugin?: unknown; args?: unknown }[] };
    calls = (parsed.calls ?? [])
      .filter((c): c is { plugin: PluginId; args: Record<string, unknown> } => isPluginId(c.plugin) && candidates.includes(c.plugin) && typeof c.args === "object" && c.args !== null)
      .slice(0, 3);
  } catch (err) {
    console.error("[plugins] plan failed", err);
    return null;
  }
  if (!calls.length) return null;
  progress(`Плагины: ${[...new Set(calls.map((c) => pluginName(c.plugin)))].join(", ")}…`);
  const found = (
    await Promise.all(
      calls.map((c) =>
        RUN[c.plugin](c.args).catch((err: unknown) => {
          console.error(`[plugins] ${c.plugin} failed`, err);
          return { plugin: c.plugin, text: "Сервис сейчас не ответил — данных нет.", sources: [] } satisfies Found;
        }),
      ),
    )
  ).filter((f): f is Found => f !== null);
  if (!found.length) return null;
  const sources: Source[] = [];
  const blocks = found.map((f) => {
    const refs = f.sources.map((s) => {
      sources.push(s);
      return `[${sources.length}]`;
    });
    const info = PLUGINS.find((p) => p.id === f.plugin)!;
    return `### Плагин «${info.name}» (источник: ${info.source.name}${refs.length ? `, ${refs.join(" ")}` : ""})\n${f.text}`;
  });
  return {
    brief:
      "Свежие данные из плагинов MARYX, полученные только что. Отвечай по ним (для чисел, дат и фактов — только по ним), " +
      "назови источник; ссылки [N] можно ставить как в тексте ниже. Если данных не хватило или сервис не ответил — так и скажи.\n\n" +
      blocks.join("\n\n"),
    sources,
    used: [...new Set(found.map((f) => f.plugin))],
  };
}
