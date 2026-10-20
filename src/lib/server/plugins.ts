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
  travel: /отел|гостиниц|хостел|апартамент|airbnb|booking|брониров|забронир|авиабилет|билет[ыа]? (на самол|в |до |из )|перел[её]т|\bрейс|слетать|полететь|поездк|путешеств|отпуск|экскурси|достопримечательн|что посмотреть|skyscanner|tripadvisor|\bflights?\b|\bhotels?\b/i,
  music: /песн|трек|альбом|исполнител|певиц|певец|музык|послушать|spotify|apple music|дискограф|сингл|плейлист|\bsongs?\b|\balbums?\b/i,
  sports: /матч|сч[её]т (игр|матч)|какой сч[её]т|чемпионат|\bлиг[аеиу]\b|\bапл\b|ла лиг|бундеслиг|серия a|лига чемпионов|\bnba\b|\bnhl\b|\bnfl\b|\bmlb\b|\bнба\b|\bнхл\b|футбол|хоккей|баскетбол|бейсбол|кто (вчера |сегодня )?выиграл|результат(ы)? (игр|матч)|расписание (игр|матч)|premier league/i,
  stocks: /акци[ияйюе]|котировк|фондов(ый|ом) рын|nasdaq|nyse|s&p|тикер|\bstocks?\b|\bshares?\b|капитализац/i,
  binance: /binance|бинанс|торгов(ая|ой|ые|ых) пар|объ[её]м торгов|\b[a-z]{2,6}\/?usdt\b/i,
  science: /исследовани|научн|уч[её]ные|доказан|метаанализ|клиническ|\bstud(y|ies)\b|\bresearch\b/i,
  books: /книг|роман[аеуы]?\b|писател|автор[ау]? |прочитать|издани|\bbooks?\b/i,
  hackernews: /hacker ?news|хакер ?ньюс|ycombinator|y combinator|\bhn\b/i,
  packages: /\bnpm\b|pypi|pip install|последн(яя|юю|ей) верси|верси[яюи] (библиотек|пакет)|\bpackages?\b|пакет[аы]? (npm|python)/i,
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
  '- travel: {"to": "город назначения по-английски", "from": "город отправления по-английски или null", "to_iata": "IATA главного аэропорта назначения (FCO)", ' +
  '"from_iata": "IATA аэропорта вылета или null", "checkin": "ГГГГ-ММ-ДД или null", "checkout": "ГГГГ-ММ-ДД или null", "adults": число путешественников}\n' +
  '- music: {"query": "исполнитель, песня или альбом", "kind": "song" | "album" | "artist"}\n' +
  '- sports: {"league": одна из soccer/eng.1 (АПЛ), soccer/esp.1, soccer/ger.1, soccer/ita.1, soccer/fra.1, soccer/uefa.champions, soccer/uefa.europa, ' +
  'soccer/usa.1, basketball/nba, hockey/nhl, football/nfl, baseball/mlb, "date": "ГГГГ-ММ-ДД или null (сегодня)", "team": "команда по-английски или null"}\n' +
  '- stocks: {"symbols": ["AAPL", "SAP.DE", "7203.T"] — тикеры Yahoo Finance, до 5}\n' +
  '- binance: {"pairs": ["BTCUSDT"] — торговые пары Binance, до 5}\n' +
  '- science: {"query": "вопрос по-английски, 3–8 слов (поиск научных работ)"}\n' +
  '- books: {"query": "название или тема", "author": "автор или null"}\n' +
  '- hackernews: {"query": "тема по-английски"}\n' +
  '- packages: {"npm": ["react"], "pypi": ["pandas"]} — названия пакетов\n' +
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

// ---------- Путешествия: ready searches on the services' own sites (no API, no key) ----------

const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const iata = (v: unknown) => (typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toLowerCase() : "");

async function travel(args: Record<string, unknown>): Promise<Found | null> {
  const to = str(args.to, 80);
  if (!to) return null;
  const from = str(args.from, 80);
  const checkin = isoDate(args.checkin);
  const checkout = isoDate(args.checkout) > checkin ? isoDate(args.checkout) : "";
  const adults = Math.min(9, Math.max(1, Math.round(num(args.adults) ?? 2)));
  const link = (base: string, params: Record<string, string>) => {
    const u = new URL(base);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    return u.toString();
  };
  const dates = checkin ? `${checkin}${checkout ? ` — ${checkout}` : ""}` : "даты не указаны";
  const sources: Source[] = [
    { title: `Отели: ${to} — Booking.com`, url: link("https://www.booking.com/searchresults.html", { ss: to, checkin, checkout, group_adults: String(adults), no_rooms: "1" }) },
    { title: `Жильё: ${to} — Airbnb`, url: link(`https://www.airbnb.com/s/${encodeURIComponent(to)}/homes`, { checkin, checkout, adults: String(adults) }) },
  ];
  if (from) {
    const words = `Flights from ${from} to ${to}${checkin ? ` on ${checkin}` : ""}${checkout ? ` returning ${checkout}` : ""}`;
    sources.push({ title: `Авиабилеты ${from} → ${to} — Google Flights`, url: link("https://www.google.com/travel/flights", { q: words }) });
    const a = iata(args.from_iata);
    const b = iata(args.to_iata);
    // Skyscanner's own address: airports and dates as yymmdd.
    if (a && b && checkin) {
      const day = (d: string) => d.slice(2).replaceAll("-", "");
      sources.push({ title: `Авиабилеты ${a.toUpperCase()} → ${b.toUpperCase()} — Skyscanner`, url: `https://www.skyscanner.net/transport/flights/${a}/${b}/${day(checkin)}/${checkout ? `${day(checkout)}/` : ""}?adultsv2=${adults}` });
    }
  }
  sources.push(
    { title: `Что посмотреть: ${to} — Tripadvisor`, url: link("https://www.tripadvisor.com/Search", { q: to }) },
    { title: `Экскурсии: ${to} — GetYourGuide`, url: link("https://www.getyourguide.com/s/", { q: to }) },
  );
  const lines = sources.map((s, i) => `${i + 1}. ${s.title}: ${s.url}`);
  return {
    plugin: "travel",
    text: `Готовые поиски для поездки (${from ? `${from} → ` : ""}${to}, ${dates}, ${adults} чел.). Цены и наличие — на сайтах сервисов, бронирует пользователь сам:\n${lines.join("\n")}`,
    sources,
  };
}

// ---------- Музыка: Apple iTunes Search ----------

interface ItunesItem {
  wrapperType: string;
  kind?: string;
  artistName?: string;
  trackName?: string;
  collectionName?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  trackCount?: number;
  trackViewUrl?: string;
  collectionViewUrl?: string;
  artistLinkUrl?: string;
  artistViewUrl?: string;
}

async function music(args: Record<string, unknown>): Promise<Found | null> {
  const query = str(args.query, 120);
  if (!query) return null;
  const entity = args.kind === "album" ? "album" : args.kind === "artist" ? "musicArtist" : "song";
  const found = await getJson<{ results: ItunesItem[] }>(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=${entity}&limit=6`);
  const items = found.results.slice(0, 6);
  const year = (d?: string) => (d ? d.slice(0, 4) : "");
  const lines = items.map((r, i) =>
    entity === "song"
      ? `${i + 1}. «${r.trackName}» — ${r.artistName}${r.collectionName ? ` (альбом «${r.collectionName}»${year(r.releaseDate) ? `, ${year(r.releaseDate)}` : ""})` : ""}`
      : entity === "album"
        ? `${i + 1}. «${r.collectionName}» — ${r.artistName}${year(r.releaseDate) ? `, ${year(r.releaseDate)}` : ""}${r.trackCount ? `, ${r.trackCount} треков` : ""}`
        : `${i + 1}. ${r.artistName}${r.primaryGenreName ? ` — ${r.primaryGenreName}` : ""}`,
  );
  const sources: Source[] = items
    .map((r) => ({ url: r.trackViewUrl ?? r.collectionViewUrl ?? r.artistLinkUrl ?? r.artistViewUrl ?? "", title: `${r.trackName ?? r.collectionName ?? r.artistName} — Apple Music` }))
    .filter((s) => /^https:\/\//.test(s.url));
  sources.push(
    { url: `https://open.spotify.com/search/${encodeURIComponent(query)}`, title: `«${query}» — поиск в Spotify` },
    { url: `https://music.youtube.com/search?q=${encodeURIComponent(query)}`, title: `«${query}» — поиск в YouTube Music` },
  );
  return {
    plugin: "music",
    text: items.length ? `Музыка по запросу «${query}» (Apple Music):\n${lines.join("\n")}\nПослушать: ссылки Apple Music, а также поиск в Spotify и YouTube Music.` : `В Apple Music ничего не нашлось по запросу «${query}».`,
    sources,
  };
}

// ---------- Спорт: ESPN's scoreboards ----------

const LEAGUES = new Set([
  "soccer/eng.1",
  "soccer/esp.1",
  "soccer/ger.1",
  "soccer/ita.1",
  "soccer/fra.1",
  "soccer/uefa.champions",
  "soccer/uefa.europa",
  "soccer/usa.1",
  "basketball/nba",
  "hockey/nhl",
  "football/nfl",
  "baseball/mlb",
]);

interface EspnEvent {
  name: string;
  date: string;
  status?: { type?: { state?: string; shortDetail?: string; description?: string } };
  competitions?: { competitors?: { homeAway?: string; score?: string; winner?: boolean; team?: { displayName?: string } }[] }[];
  links?: { href?: string }[];
}

async function sports(args: Record<string, unknown>): Promise<Found | null> {
  const league = str(args.league, 40);
  if (!LEAGUES.has(league)) return null;
  const date = isoDate(args.date);
  const team = str(args.team, 60).toLowerCase();
  const board = await getJson<{ leagues?: { name?: string }[]; events?: EspnEvent[] }>(
    `https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard${date ? `?dates=${date.replaceAll("-", "")}` : ""}`,
  );
  const name = board.leagues?.[0]?.name ?? league;
  let events = board.events ?? [];
  // The team's own matches, when it has any that day.
  const theirs = team ? events.filter((e) => e.name.toLowerCase().includes(team)) : [];
  events = (theirs.length ? theirs : events).slice(0, 12);
  if (!events.length) return { plugin: "sports", text: `${name}: матчей${date ? ` на ${date}` : " сегодня"} нет.`, sources: [] };
  const lines = events.map((e) => {
    const sides = e.competitions?.[0]?.competitors ?? [];
    const home = sides.find((s) => s.homeAway === "home") ?? sides[0];
    const away = sides.find((s) => s.homeAway === "away") ?? sides[1];
    const state = e.status?.type?.state;
    const when = new Date(e.date).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    const score = state === "pre" ? "" : ` ${home?.score ?? "?"}:${away?.score ?? "?"}`;
    const status = state === "pre" ? `начало ${when} UTC` : state === "in" ? `идёт (${e.status?.type?.shortDetail ?? ""})` : "завершён";
    return `${home?.team?.displayName ?? "?"}${score} ${away?.team?.displayName ?? "?"} — ${status}`;
  });
  const sources = events
    .map((e) => ({ url: e.links?.[0]?.href ?? "", title: `${e.name} — ESPN` }))
    .filter((s) => /^https:\/\//.test(s.url))
    .slice(0, 6);
  return { plugin: "sports", text: `${name}${date ? `, ${date}` : ", сегодня"} (ESPN):\n${lines.join("\n")}`, sources };
}

// ---------- Акции: Yahoo Finance's chart data (Stooq as a fallback) ----------

async function stocks(args: Record<string, unknown>): Promise<Found | null> {
  const symbols = list(args.symbols)
    .map((s) => s.toUpperCase())
    .filter((s) => /^[A-Z0-9.\-^=]{1,15}$/.test(s))
    .slice(0, 5);
  if (!symbols.length) return null;
  const lines: string[] = [];
  const sources: Source[] = [];
  for (const symbol of symbols) {
    try {
      const chart = await getJson<{ chart: { result?: { meta: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; currency?: string; exchangeName?: string; longName?: string; shortName?: string; regularMarketTime?: number; regularMarketDayHigh?: number; regularMarketDayLow?: number } }[] } }>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      );
      const meta = chart.chart.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) throw new Error("no price");
      const before = meta.chartPreviousClose ?? meta.previousClose;
      const change = before ? ((meta.regularMarketPrice - before) / before) * 100 : undefined;
      const at = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : "";
      lines.push(
        `${meta.longName ?? meta.shortName ?? symbol} (${symbol}, ${meta.exchangeName ?? ""}): ${fixed(meta.regularMarketPrice)} ${meta.currency ?? ""}${change !== undefined ? `, ${change >= 0 ? "+" : ""}${fixed(change, 2)}% к прошлому закрытию` : ""}${meta.regularMarketDayHigh ? `, за день ${fixed(meta.regularMarketDayLow ?? 0)}–${fixed(meta.regularMarketDayHigh)}` : ""}${at ? ` (на ${at} UTC)` : ""}.`,
      );
      sources.push({ url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`, title: `${symbol} — Yahoo Finance` });
    } catch {
      // Stooq names US shares "aapl.us"; others keep their market suffix.
      const s = (symbol.includes(".") ? symbol : `${symbol}.US`).toLowerCase();
      const csv = await getText(`https://stooq.com/q/l/?s=${encodeURIComponent(s)}&f=sd2t2ohlcvn&h&e=csv`).catch(() => "");
      const row = csv.trim().split("\n")[1]?.split(",");
      if (row && row[6] && row[6] !== "N/D") {
        const [, date, , open, high, low, close] = row;
        const change = ((Number(close) - Number(open)) / Number(open)) * 100;
        lines.push(`${row[8] ?? symbol} (${symbol}): ${close} на ${date} (открытие ${open}, за день ${low}–${high}, ${change >= 0 ? "+" : ""}${fixed(change, 2)}% с открытия).`);
        sources.push({ url: `https://stooq.com/q/?s=${s}`, title: `${symbol} — Stooq` });
      } else lines.push(`${symbol}: котировка не найдена.`);
    }
  }
  return { plugin: "stocks", text: `Котировки (с задержкой биржи; не инвестиционный совет):\n${lines.join("\n")}`, sources };
}

// ---------- Binance: public market data (no account) ----------

async function binance(args: Record<string, unknown>): Promise<Found | null> {
  const pairs = list(args.pairs)
    .map((p) => p.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter((p) => /^[A-Z0-9]{5,20}$/.test(p))
    .slice(0, 5);
  if (!pairs.length) return null;
  const tickers = await getJson<{ symbol: string; lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string }[]>(
    `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(pairs))}`,
  );
  const lines = tickers.map((t) => {
    const n = (v: string) => fixed(Number(v), Number(v) < 1 ? 6 : 2);
    return `${t.symbol}: ${n(t.lastPrice)} (за 24 ч ${Number(t.priceChangePercent) >= 0 ? "+" : ""}${fixed(Number(t.priceChangePercent), 2)}%, от ${n(t.lowPrice)} до ${n(t.highPrice)}, объём ${fixed(Number(t.quoteVolume), 0)} в котируемой валюте).`;
  });
  return {
    plugin: "binance",
    text: `Binance, сейчас:\n${lines.join("\n")}`,
    sources: tickers.map((t) => ({ url: `https://www.binance.com/en/trade/${t.symbol}`, title: `${t.symbol} — Binance` })),
  };
}

// ---------- Научные исследования: OpenAlex ----------

interface Work {
  id: string;
  display_name: string;
  publication_year?: number;
  cited_by_count?: number;
  doi?: string | null;
  primary_location?: { source?: { display_name?: string } | null } | null;
  authorships?: { author?: { display_name?: string } }[];
  abstract_inverted_index?: Record<string, number[]> | null;
}

/** OpenAlex keeps abstracts as word → positions. */
function abstractOf(index: Work["abstract_inverted_index"], words = 70): string {
  if (!index) return "";
  const at: string[] = [];
  for (const [word, places] of Object.entries(index)) for (const p of places) at[p] = word;
  const text = at.filter(Boolean);
  return text.slice(0, words).join(" ") + (text.length > words ? "…" : "");
}

async function science(args: Record<string, unknown>): Promise<Found | null> {
  const query = str(args.query, 150);
  if (!query) return null;
  const found = await getJson<{ results: Work[] }>(
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=6&filter=has_abstract:true&select=id,display_name,publication_year,cited_by_count,doi,primary_location,authorships,abstract_inverted_index`,
  );
  const works = found.results.slice(0, 6);
  if (!works.length) return { plugin: "science", text: `Научных работ по запросу «${query}» не нашлось.`, sources: [] };
  const lines = works.map((w, i) => {
    const authors = (w.authorships ?? []).map((a) => a.author?.display_name).filter(Boolean);
    const who = authors.length ? `${authors[0]}${authors.length > 1 ? " и др." : ""}` : "";
    const journal = w.primary_location?.source?.display_name;
    return `${i + 1}. «${w.display_name}» — ${[who, w.publication_year, journal].filter(Boolean).join(", ")}; цитирований: ${w.cited_by_count ?? 0}. ${abstractOf(w.abstract_inverted_index)}`;
  });
  return {
    plugin: "science",
    text: `Научные работы по запросу «${query}» (OpenAlex):\n${lines.join("\n")}`,
    sources: works.map((w) => ({ url: w.doi ?? w.id, title: w.display_name })),
  };
}

// ---------- Книги: Open Library ----------

async function books(args: Record<string, unknown>): Promise<Found | null> {
  const query = str(args.query, 150);
  const author = str(args.author, 100);
  if (!query && !author) return null;
  const params = new URLSearchParams({ limit: "6", fields: "title,author_name,first_publish_year,edition_count,key" });
  if (query) params.set("q", query);
  if (author) params.set("author", author);
  const found = await getJson<{ docs: { title: string; author_name?: string[]; first_publish_year?: number; edition_count?: number; key: string }[] }>(`https://openlibrary.org/search.json?${params}`);
  const docs = found.docs.slice(0, 6);
  if (!docs.length) return { plugin: "books", text: `Книг по запросу «${query || author}» не нашлось.`, sources: [] };
  const lines = docs.map((d, i) => `${i + 1}. «${d.title}» — ${d.author_name?.slice(0, 2).join(", ") ?? "автор неизвестен"}${d.first_publish_year ? `, ${d.first_publish_year}` : ""}${d.edition_count ? `, изданий: ${d.edition_count}` : ""}`);
  return {
    plugin: "books",
    text: `Книги по запросу «${query || author}» (Open Library):\n${lines.join("\n")}`,
    sources: docs.map((d) => ({ url: `https://openlibrary.org${d.key}`, title: `${d.title} — Open Library` })),
  };
}

// ---------- Hacker News (Algolia) ----------

async function hackernews(args: Record<string, unknown>): Promise<Found | null> {
  const query = str(args.query, 150);
  if (!query) return null;
  const found = await getJson<{ hits: { objectID: string; title?: string; url?: string; points?: number; num_comments?: number; created_at: string }[] }>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=6`,
  );
  const hits = found.hits.filter((h) => h.title).slice(0, 6);
  if (!hits.length) return { plugin: "hackernews", text: `На Hacker News ничего не нашлось по запросу «${query}».`, sources: [] };
  const lines = hits.map((h, i) => `${i + 1}. ${h.title} — ${h.points ?? 0} голосов, ${h.num_comments ?? 0} комментариев (${new Date(h.created_at).toLocaleDateString("ru-RU")})`);
  return {
    plugin: "hackernews",
    text: `Hacker News по запросу «${query}»:\n${lines.join("\n")}`,
    sources: hits.map((h) => ({ url: `https://news.ycombinator.com/item?id=${h.objectID}`, title: `${h.title} — Hacker News` })),
  };
}

// ---------- npm и PyPI ----------

async function packages(args: Record<string, unknown>): Promise<Found | null> {
  const npm = list(args.npm).filter((n) => /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(n)).slice(0, 4);
  const pypi = list(args.pypi).filter((n) => /^[A-Za-z0-9][\w.-]*$/.test(n)).slice(0, 4);
  if (!npm.length && !pypi.length) return null;
  const lines: string[] = [];
  const sources: Source[] = [];
  for (const name of npm) {
    try {
      const p = await getJson<{ version: string; description?: string; license?: string }>(`https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`);
      lines.push(`npm ${name}: последняя версия ${p.version}${p.license ? `, лицензия ${p.license}` : ""}. ${p.description ?? ""}`.trim());
      sources.push({ url: `https://www.npmjs.com/package/${name}`, title: `${name} — npm` });
    } catch {
      lines.push(`npm ${name}: пакет не найден.`);
    }
  }
  for (const name of pypi) {
    try {
      const p = await getJson<{ info: { version: string; summary?: string; license?: string }; releases?: Record<string, { upload_time?: string }[]> }>(`https://pypi.org/pypi/${name}/json`);
      const uploaded = p.releases?.[p.info.version]?.[0]?.upload_time;
      lines.push(`PyPI ${name}: последняя версия ${p.info.version}${uploaded ? ` от ${new Date(uploaded).toLocaleDateString("ru-RU")}` : ""}${p.info.license && p.info.license.length < 40 ? `, лицензия ${p.info.license}` : ""}. ${p.info.summary ?? ""}`.trim());
      sources.push({ url: `https://pypi.org/project/${name}/`, title: `${name} — PyPI` });
    } catch {
      lines.push(`PyPI ${name}: пакет не найден.`);
    }
  }
  return { plugin: "packages", text: lines.join("\n"), sources };
}

const RUN: Record<PluginId, (args: Record<string, unknown>) => Promise<Found | null>> = {
  weather,
  currency,
  crypto: cryptoPrices,
  wikipedia,
  news,
  github,
  holidays,
  arxiv,
  time,
  travel,
  music,
  sports,
  stocks,
  binance,
  science,
  books,
  hackernews,
  packages,
};

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
