// MARYX — the platform's own AI. It isn't a separately trained model: for
// every message it picks the best available real model (fast and cheap for
// simple questions, strong for code and long tasks, the most powerful one
// for "think deeper"), turns on web search or drawing when the request calls
// for it, speaks with its own persona and remembers facts about the user.

import { and, asc, eq, inArray } from "drizzle-orm";
import type { ChatRequest, ChatUsage, ModelInfo, Place, ProviderId, Source } from "@/lib/types";
import { streamChat } from "./chat";
import { isConfigured, maryxOnly } from "./config";
import { getDb, schema } from "./db";
import { listModels } from "./models";
import { creditValueUsd, takeFraction } from "./billing/credits";
import { endUserId } from "./own-key";
import { chatEntry, recordCosts, requestChars, type Meter } from "./spend";

type Tier = "fast" | "smart" | "deep";

/** Candidate models per tier, best first; direct keys before their OpenRouter copies. */
const TIERS: Record<Tier, [ProviderId, string][]> = {
  fast: [
    ["anthropic", "claude-haiku-5-5"],
    ["openrouter", "anthropic/claude-haiku-5.5"],
    ["openai", "gpt-6-luna"],
    ["openrouter", "openai/gpt-6-luna"],
    ["google", "gemini-3.8-flash"],
    ["openrouter", "google/gemini-3.8-flash"],
    ["openrouter", "deepseek/deepseek-v4.1-flash"],
    ["deepseek", "deepseek-chat"],
    ["qwen", "qwen3.8-flash"],
    ["openrouter", "qwen/qwen3.8-flash"],
  ],
  smart: [
    ["anthropic", "claude-sonnet-5-5"],
    ["openrouter", "anthropic/claude-sonnet-5.5"],
    ["openai", "gpt-6.1-sol"],
    ["openrouter", "openai/gpt-6.1-sol"],
    ["google", "gemini-3.1-pro-preview"],
    ["openrouter", "google/gemini-3.1-pro-preview"],
    ["openrouter", "deepseek/deepseek-v4-pro"],
    ["qwen", "qwen3.8-max"],
    ["openrouter", "qwen/qwen3.8-max-0902"],
  ],
  deep: [
    ["anthropic", "claude-opus-5-5"],
    ["openrouter", "anthropic/claude-opus-5.5"],
    ["openai", "gpt-6-astra"],
    ["openrouter", "openai/gpt-6-astra"],
    ["google", "gemini-3.1-pro-preview"],
    ["openrouter", "google/gemini-3.1-pro-preview"],
    ["qwen", "qwen3.8-max"],
    ["openrouter", "qwen/qwen3.8-max-0902"],
  ],
};

// Note: \b doesn't work next to Cyrillic letters in JS, so word edges are spelled out.
const DRAW_VERB = "(нарисуй|изобрази|сгенерируй|создай|сделай)(те)?";
const IMAGE_NOUN =
  "(картинк|изображени|рисун|иллюстрац|логотип|постер|обложк|аватар|арт(?![а-яё])|фото(?![а-яё]|граф|син|сесс)|обои(?![а-яё]))";

const DRAW_REQUEST = new RegExp(`^${DRAW_VERB}\\s+((мне|пожалуйста|новую|новый|красивую|красивый)\\s+)*${IMAGE_NOUN}`);

/**
 * A request to draw: "нарисуй…", or a creation verb right before an image
 * noun at the start ("сделай логотип…", "сгенерируй картинку…"). Questions
 * ("как сделать фото…?") and anything else are left to the text models.
 */
export function wantsImage(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (/^(как|что|зачем|почему|где|можно ли)(?![а-яё])/.test(t)) return false;
  if (/^(нарисуй|нарисуйте|изобрази|изобразите)(?![а-яё])/.test(t)) return true;
  if (/^(draw|paint|generate an? (image|picture|illustration))\b/.test(t)) return true;
  return DRAW_REQUEST.test(t);
}

const EDIT_STRONG =
  /(обработ|отретуш|ретуш|отредакт|фотошоп|перерисуй|раскрась|преврати|стилизуй|восстанови\s+(фото|снимок|изображение)|сделай\s+(из\s+(него|неё|нее|этого)|е[её]|его)\s)/;
const EDIT_WEAK = /(убер|удали|замени|поменяй|измени|добавь|улучши|исправь|сделай)/;
const EDIT_TARGET =
  /(фон|фото|снимк|лиц|кож|прыщ|морщин|блик|тен[ьи]|цвет|свет|небо|волос|глаз|улыбк|предмет|надпис|водян|качеств|ярче|светлее|темнее|резче|ч[её]тче|ч[её]рно-бел|естествен)/;
/** Words about the photo ("сделай описание товара по фото", "придумай подпись к фото"), not a new picture. */
const WANTS_TEXT = /(описани|подпис[ьиея]|(?<![а-яё])пост(?![а-яё])|стать[юяи]|отзыв|х[еэ]штег|характеристик|анализ|разбор)/;

/**
 * A request to edit the attached photo ("обработай фото", "убери фон",
 * "сделай светлее"), as opposed to a question about it ("что на фото?",
 * "переведи текст на скрине"), which the text models answer.
 */
export function wantsImageEdit(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 600) return false;
  if (/^(как|что|зачем|почему|где|можно ли|опиши|расскажи|переведи|прочитай|распознай|объясни|оцени|сколько|кто)(?![а-яё])/.test(t)) {
    return false;
  }
  if (WANTS_TEXT.test(t)) return false;
  return EDIT_STRONG.test(t) || (EDIT_WEAK.test(t) && EDIT_TARGET.test(t));
}

const LEAD = "^((а|и|ну|теперь|ещё|еще|давай|пожалуйста)\\s+)*";
/** A change that is about looks by itself ("а теперь в стиле аниме", "перекрась в красный"). */
const STYLE_CHANGE = new RegExp(
  `${LEAD}(в\\s+стиле|в\\s+виде|как\\s+в|перекрась|раскрась|преврати|стилизуй|переодень|надень|отзеркаль|кадрируй)(?![а-яё])`,
);
/** How a follow-up change starts ("сделай…", "добавь…", "пусть…"). */
const CHANGE = new RegExp(
  `${LEAD}(теперь|пусть|сделай|добавь|убери|удали|замени|поменяй|измени|верни|поверни|разверни|увеличь|уменьши|оставь|улучши|исправь|без|больше|меньше|ярче|светлее|темнее|ч[её]тче|резче)(?![а-яё])`,
);
/** …and what in the picture it is about ("очки", "фон", "синим", "ярче"). */
const VISUAL =
  /(фон|фото|снимк|картинк|изображени|лиц|кож|волос|глаз|улыбк|очк|шляп|кепк|бород|ус(ы|ов)?(?![а-яё])|одежд|плать|костюм|рубашк|куртк|небо|облак|снег|дожд|закат|рассвет|ноч|солнц|свет|тен[ьи]|цвет|красн|син|зел[её]н|ж[её]лт|бел|ч[её]рн|розов|фиолет|оранж|золот|ярк|ярче|темн|контраст|насыщ|стил|аниме|мульт|акварел|маслом|пиксел|неон|ретро|винтаж|фотореал|резк|ч[её]тк|размыт|кадр|ракурс|море|пляж|город|лес(?![а-яё])|горы|космос|кот(ик|а|у|ом|е)?(?![а-яё])|кошк|собак)/;

/**
 * A follow-up change to the picture the chat just made or edited ("сделай фон
 * синим", "а теперь в стиле аниме"), Nano Banana style: the picture is
 * edited again, with no need to attach it. A new drawing ("нарисуй кота"),
 * a question, a text request ("сделай план…") or a video request is not one.
 */
export function wantsFollowUpEdit(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 400 || t.endsWith("?")) return false;
  if (/^(нарисуй|изобрази|сгенерируй|создай)/.test(t) || /(нов|друг)(ую|ой|ое|ый)\s+(картинк|изображени|рисун|фото)/.test(t)) return false;
  if (/(видео|ролик|анимац|анимируй|оживи)/.test(t) || WANTS_TEXT.test(t)) return false;
  return wantsImageEdit(t) || STYLE_CHANGE.test(t) || (CHANGE.test(t) && VISUAL.test(t));
}

const VIDEO_REQUEST =
  /^((а|и|теперь|давай|пожалуйста)\s+)*(сними|снимите|сделай|сделайте|создай|создайте|сгенерируй|сгенерируйте|смонтируй)\s+((мне|нам|пожалуйста|[а-яё-]+(ое|ый|ий|ой|ую|ая|ее|ие))\s+){0,4}(видео|видеоролик|ролик|клип|анимаци)/;
/** About a video, not one: its script, plan, description or text (or an animation in code). */
const VIDEO_TEXT = /(сценари|план(?![а-яё]*ет)|текст|иде[июяй]|описани|субтитр|раскадровк|html|css|svg|canvas|javascript|(?<![а-яё])код|сайт)/;

/** A request for a video: "сними видео…", "сделай вертикальное видео…" (not "как снять видео?", "сделай сценарий видео"). */
export function wantsVideo(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 2000 || t.endsWith("?")) return false;
  if (VIDEO_TEXT.test(t.slice(0, 80)) || WANTS_TEXT.test(t.slice(0, 80))) return false;
  return VIDEO_REQUEST.test(t) || /^(make|generate|create) (a |an )?(short )?(video|clip)\b/.test(t);
}

/** "Оживи фото", "анимируй это", "сделай из фото видео": bring a picture to life as a video. */
export function wantsAnimate(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 2000 || t.endsWith("?")) return false;
  return (
    /^((а|и|теперь|давай|пожалуйста)\s+)*(оживи|оживите|анимируй|анимируйте)(?![а-яё])/.test(t) ||
    /(сделай|преврати)(те)?\s+(из\s+)?(это(го)?|е[её]|его|фото|картинк\S*|снимк\S*)\s+(в\s+)?(видео|ролик|анимаци)/.test(t)
  );
}

/** Questions about the world right now, which a model can't know without searching. */
function wantsSearch(text: string): boolean {
  return /(новост|что нового|что (произошло|случилось)|курс (доллар|евро|рубл|юан|валют|биткоин|акци)|погод[аеуы]|кто выиграл|результат(ы)? (матча|игры|выборов)|latest news|current price|weather)/i.test(
    text.slice(0, 300),
  );
}

function needsSmart(text: string, hasDocuments: boolean): boolean {
  if (hasDocuments || text.length > 700) return true;
  return /(```|(?<![а-яё])код|функци|скрипт|программ|python|javascript|typescript|\bjava\b|c\+\+|\bsql\b|regex|регулярн|баг|ошибк[а-яё]* в код|компил|\bapi\b|html|css|react|игр[уаы]|сайт|лендинг|приложени|калькулятор|анимаци|алгоритм|подробно|детально|проанализируй|сравни|стратеги|бизнес-план|презентаци|слайд|эссе|статью|докажи|реши задачу|рассчитай|переведи текст|резюме|договор)/i.test(
    text,
  );
}

/**
 * A message that is only thanks or a greeting needs no strong model, whatever
 * came before ("Спасибо большое!" — yes; "Ок, а теперь перепиши на Go" — no).
 */
const SMALL_TALK =
  /^(спасибо|благодарю|спс|ок|окей|ok|понятно|ясно|супер|класс|отлично|круто|привет|здравствуй(те)?|пока|до свидания|thanks|thank you|hi|hello)(?:[\s!.,)?:]+|большое|огромное|тебе|вам|друг|бро)*$/;

function tierOf(provider: ProviderId, id: string): Tier | undefined {
  // The strongest tier that lists the model (Gemini Pro is in both smart and deep).
  return (["deep", "smart", "fast"] as Tier[]).find((t) => TIERS[t].some(([p, m]) => p === provider && m === id));
}

/** Which company made a model, so a fallback can come from another one. */
function vendorOf(m: ModelInfo): string {
  return m.provider === "openrouter" ? m.id.split("/")[0] : m.provider;
}

export interface MaryxPlan {
  model: ModelInfo;
  /** Next best models to try, from other vendors first, if the chosen one fails before answering. */
  fallbacks: ModelInfo[];
  webSearch: boolean;
}

/** Picks the model (and search) for one message. */
export async function planRoute(input: {
  text: string;
  hasImages: boolean;
  /** The message or an earlier one in the conversation brings documents. */
  hasDocuments: boolean;
  deepThinking: boolean;
  webSearch: boolean;
  /** MARYX's previous answer in this chat, to keep follow-ups on a strong model. */
  previous?: { provider?: ProviderId; model?: string; content: string };
  /** The user brings their own OpenRouter key: MARYX picks only OpenRouter models, which it pays for. */
  ownKey?: boolean;
  /** A research report: a strong model writes it from what was found (it doesn't search itself). */
  research?: boolean;
  /** A strong model, whatever the text (MARYX's writing jobs: a document edit). */
  strong?: boolean;
}): Promise<MaryxPlan> {
  const { models } = await listModels("chat", { ownKey: input.ownKey });
  // Only server models: the browser ones run on the visitor's device, not here.
  const available = models.filter(
    (m) => m.provider !== "maryx" && !m.local && (!input.ownKey || m.provider === "openrouter"),
  );
  if (available.length === 0) throw new Error("MARYX не может ответить: не подключена ни одна модель.");

  const search = !input.research && (input.ownKey || isConfigured("openrouter")) && (input.webSearch || wantsSearch(input.text));
  let tier: Tier = input.deepThinking ? "deep" : input.research || input.strong || needsSmart(input.text, input.hasDocuments) ? "smart" : "fast";
  // A short follow-up ("а подробнее?", "исправь ошибку") to a strong answer or to
  // code stays on a strong model: alone it looks simple, in context it isn't.
  const prev = input.previous;
  if (tier === "fast" && prev && input.text.length < 400 && !SMALL_TALK.test(input.text.trim().toLowerCase())) {
    const prevTier = prev.provider && prev.model ? tierOf(prev.provider, prev.model) : undefined;
    if (prevTier === "smart" || prevTier === "deep" || prev.content.includes("```")) tier = "smart";
  }
  // Fall back to the neighbouring tiers when the preferred one has nothing available.
  const order: Tier[] = tier === "fast" ? ["fast", "smart", "deep"] : tier === "smart" ? ["smart", "deep", "fast"] : ["deep", "smart", "fast"];

  const usable = (m: ModelInfo) => (!input.hasImages || m.vision) && (!search || m.provider === "openrouter");
  const ranked: ModelInfo[] = [];
  for (const t of order) {
    for (const [provider, id] of TIERS[t]) {
      const m = available.find((x) => x.provider === provider && x.id === id);
      if (m && usable(m) && !ranked.includes(m)) ranked.push(m);
    }
  }
  // Nothing from our lists (e.g. only Ollama): featured models that fit, then any.
  if (ranked.length === 0) {
    const any = available.find((m) => m.featured && usable(m)) ?? available.find(usable) ?? available[0];
    return { model: any, fallbacks: [], webSearch: search && any.provider === "openrouter" };
  }
  const [model, ...rest] = ranked;
  // Another vendor first: when one company's API is down, its other models usually are too.
  const fallbacks = [...rest.filter((m) => vendorOf(m) !== vendorOf(model)), ...rest.filter((m) => vendorOf(m) === vendorOf(model))];
  return { model, fallbacks: fallbacks.slice(0, 2), webSearch: search };
}

/**
 * The fast model MARYX uses for its own small jobs (memory, titles,
 * suggestions, research searches). What each call costs is recorded against
 * the user's request (`meter`), with their own key when the request had one.
 * With `webSearch` it searches the web and returns the pages it read.
 */
async function quickCall(
  system: string,
  user: string,
  timeoutMs: number,
  meter: Meter,
  opts: { webSearch?: boolean; maxTokens?: number; strong?: boolean } = {},
): Promise<{ text: string; sources: Source[] }> {
  const plan = await planRoute({
    text: "",
    hasImages: false,
    hasDocuments: false,
    deepThinking: false,
    webSearch: Boolean(opts.webSearch),
    ownKey: meter.paidBy === "byok" && Boolean(meter.key),
    strong: opts.strong,
  });
  // One fallback (from another vendor) if the first model is down.
  return callModels([plan.model, ...plan.fallbacks].slice(0, 2), system, user, timeoutMs, meter, {
    webSearch: Boolean(opts.webSearch && plan.webSearch),
    maxTokens: opts.maxTokens,
    light: true,
  });
}

/** Asks `models` in turn (the next one when one fails) and records what each call cost against `meter`. */
async function callModels(
  models: ModelInfo[],
  system: string,
  user: string,
  timeoutMs: number,
  meter: Meter,
  opts: { webSearch?: boolean; maxTokens?: number; light?: boolean },
): Promise<{ text: string; sources: Source[]; model: ModelInfo }> {
  const ownKey = meter.paidBy === "byok" && meter.key ? meter.key : undefined;
  const signal = AbortSignal.timeout(timeoutMs);
  for (const [i, model] of models.entries()) {
    let out = "";
    const sources: Source[] = [];
    let usage: ChatUsage | undefined;
    let complete = false;
    const request: ChatRequest = {
      provider: model.provider,
      model: model.id,
      system,
      light: opts.light,
      webSearch: Boolean(opts.webSearch),
      messages: [{ role: "user", content: user }],
      apiKey: model.provider === "openrouter" ? ownKey : undefined,
      endUser: endUserId(meter.userId),
      // Titles, follow-ups and memory notes are short.
      maxTokens: model.provider === "ollama" || model.provider === "custom" ? undefined : (opts.maxTokens ?? 4000),
    };
    try {
      for await (const event of streamChat(request, signal)) {
        if (event.type === "text") out += event.text;
        else if (event.type === "source" && !sources.some((x) => x.url === event.url)) sources.push({ url: event.url, title: event.title });
        else if (event.type === "usage") usage = event.usage;
      }
      complete = true;
      // A self-hosted server without a reasoning parser leaves the model's thinking in the text.
      return { text: out.replace(/^[\s\S]*<\/think>/, "").trim(), sources, model };
    } catch (err) {
      if (i === models.length - 1 || signal.aborted) throw err;
    } finally {
      const entry = chatEntry(
        "background",
        model.provider,
        model.id,
        usage,
        { input: requestChars(request), output: out.length },
        undefined,
        !complete,
      );
      if (entry) {
        try {
          // On credits these jobs are paid with credits too; their small costs add up to whole credits.
          const credits = meter.paidBy === "credits" ? await takeFraction(meter.userId, entry.usd / creditValueUsd()) : 0;
          await recordCosts(meter.userId, meter.paidBy, [entry], credits);
        } catch (err) {
          console.error("[maryx] cost not recorded", err);
        }
      }
    }
  }
  throw new Error("MARYX не смог ответить");
}

async function quickText(system: string, user: string, timeoutMs: number, meter: Meter): Promise<string> {
  return (await quickCall(system, user, timeoutMs, meter)).text;
}

// ---------- Deep research ----------

/** What one line of research found: a short summary and the pages it read. */
export interface Finding {
  query: string;
  summary: string;
  sources: Source[];
}

const RESEARCH_PLAN =
  "Ты планируешь веб-исследование. По вопросу пользователя составь от 3 до 5 разных поисковых запросов, которые вместе " +
  "покроют тему: факты и цифры, свежие новости, мнения экспертов, сравнения и подводные камни. Пиши запросы на том языке, " +
  "на котором по теме больше хороших источников. Верни только JSON-массив строк, без пояснений.";
const RESEARCH_SEARCH =
  "Найди в интернете самые надёжные и свежие сведения по запросу. Ответь сжато (до 250 слов): ключевые факты, цифры, " +
  "даты и кто что утверждает, с указанием источника каждого утверждения. Если источники расходятся — так и скажи. Не выдумывай.";
/** Research lines at most, and how long the searches may take together. */
const RESEARCH_QUERIES = 5;
const RESEARCH_SEARCH_MS = 75_000;

/**
 * Deep research: MARYX plans several searches for the question, runs them at
 * once and returns what each found (the report itself is the chat's answer).
 * `progress` tells the user each step. Searches that fail are left out.
 */
export async function research(question: string, meter: Meter, progress: (step: string) => void): Promise<Finding[]> {
  progress("Составляю план исследования");
  let queries: string[] = [];
  try {
    const out = await quickText(RESEARCH_PLAN, question.slice(0, 3000), 20_000, meter);
    const parsed: unknown = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1));
    if (Array.isArray(parsed)) {
      queries = parsed
        .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
        .map((q) => q.trim().slice(0, 200))
        .slice(0, RESEARCH_QUERIES);
    }
  } catch {
    // No plan: the question itself is searched.
  }
  if (queries.length === 0) queries = [question.trim().slice(0, 200)];
  progress(`Ищу по ${queries.length} направлениям: ${queries.map((q) => `«${q}»`).join(", ")}`);
  const findings = await Promise.all(
    queries.map(async (query): Promise<Finding> => {
      try {
        const { text, sources } = await quickCall(RESEARCH_SEARCH, query, RESEARCH_SEARCH_MS, meter, { webSearch: true, maxTokens: 1500 });
        return { query, summary: text.slice(0, 4000), sources };
      } catch (err) {
        console.error("[research] search failed", query, err);
        return { query, summary: "", sources: [] };
      }
    }),
  );
  const found = findings.filter((f) => f.summary);
  const pages = new Set(found.flatMap((f) => f.sources.map((s) => s.url))).size;
  progress(found.length ? `Изучил ${pages} источников. Пишу отчёт` : "Свежих источников не нашлось — отвечаю по своим знаниям");
  return found;
}

/**
 * The research for the report's writer: every source numbered once (as the
 * browser lists them), each line's findings citing those numbers.
 */
export function researchBrief(findings: Finding[]): { brief: string; sources: Source[] } {
  const sources: Source[] = [];
  const number = (s: Source) => {
    let i = sources.findIndex((x) => x.url === s.url);
    if (i < 0) i = sources.push(s) - 1;
    return i + 1;
  };
  const parts = findings.map((f) => {
    const refs = f.sources.map((s) => `[${number(s)}] ${s.title ?? s.url} — ${s.url}`).join("\n");
    return `### Запрос: ${f.query}\n${f.summary}${refs ? `\nИсточники:\n${refs}` : ""}`;
  });
  if (!parts.length) return { brief: "", sources };
  const brief = [
    "Ниже — результаты веб-исследования по вопросу пользователя. Напиши по ним подробный отчёт:",
    "сначала «Коротко» — главный вывод в 3–5 пунктах, затем разделы с заголовками; для сравнений — таблица.",
    "После каждого факта ставь номер источника в квадратных скобках, например [2], по нумерации ниже.",
    "Если источники расходятся или данных мало — скажи об этом прямо. Не выдумывай того, чего нет в результатах.",
    "Список источников в конце не нужен: он показывается под ответом.",
    "",
    ...parts,
  ].join("\n");
  return { brief, sources };
}


// ---------- Консилиум ----------

/** How long an expert may take. */
const EXPERT_MS = 75_000;
const EXPERTS = ["", "одному эксперту", "двум экспертам", "трём экспертам"];

const COUNCIL_EXPERT =
  "Ты — один из экспертов, к которым MARYX обратился за независимым мнением. Ответь на вопрос пользователя как можно " +
  "точнее, полнее и полезнее, по существу и без вступлений. Если однозначного ответа нет или в вопросе есть подвох — " +
  "скажи об этом прямо. Отвечай на языке вопроса.";

/**
 * Консилиум: the question goes to up to three strong models of different
 * vendors at once. Their answers (those that came) come back for the answer's
 * model to combine into one, better than each.
 */
export async function council(question: string, context: string, meter: Meter, progress: (step: string) => void): Promise<string[]> {
  const plan = await planRoute({
    text: question,
    hasImages: false,
    hasDocuments: false,
    deepThinking: false,
    webSearch: false,
    ownKey: meter.paidBy === "byok" && Boolean(meter.key),
    strong: true,
  });
  // The plan's fallbacks come from other vendors first: different minds.
  const experts = [plan.model, ...plan.fallbacks].slice(0, 3);
  progress(`Задаю вопрос ${EXPERTS[experts.length]} одновременно`);
  const ask = context ? `Предыдущий разговор (для контекста):\n${context}\n\nВопрос:\n${question}` : question;
  const answers = await Promise.all(
    experts.map((m) =>
      callModels([m], COUNCIL_EXPERT, excerpt(ask, 40_000), EXPERT_MS, meter, { maxTokens: 3000 }).then(
        (r) => r.text,
        (err) => {
          console.error("[maryx] expert failed", m.id, err);
          return "";
        },
      ),
    ),
  );
  const opinions = answers.filter(Boolean);
  progress(
    opinions.length
      ? `Ответили ${opinions.length} из ${experts.length}. Сверяю ответы и пишу лучший`
      : "Эксперты не ответили — отвечаю сам",
  );
  return opinions;
}

/** What the answer's model is told about the experts' answers (empty when there are none). */
export function councilBrief(opinions: string[]): string {
  if (!opinions.length) return "";
  const n = opinions.length;
  return [
    `Ты собрал консилиум: на вопрос пользователя независимо ответили ${n} ${n === 1 ? "эксперт" : "эксперта"}. Их ответы ниже.`,
    "Сверь их и напиши один итоговый ответ — лучше, чем каждый по отдельности: возьми самое точное и полезное из каждого, исправь ошибки, убери повторы.",
    "Где эксперты расходятся — разберись, кто прав, и коротко объясни. Если расхождения были, в конце добавь короткий раздел «Где мнения разошлись».",
    "Не пересказывай экспертов по очереди и не называй модели или компании — пиши от себя.",
    "",
    ...opinions.map((o, i) => `### Эксперт ${i + 1}\n${excerpt(o, 8000)}`),
  ].join("\n");
}

/** How answers should look, for MARYX and for every other model in the chat. */
export const ANSWER_STYLE = [
  "Отвечай на языке пользователя. Сразу к сути, без вступлений вроде «Конечно!» или «Отличный вопрос».",
  "Длина — по задаче: на простой вопрос хватит пары предложений, сложный разбери по шагам с заголовками и списками.",
  "Markdown: таблицы для сравнений, код в блоках с указанием языка, формулы в LaTeX ($...$ в строке, $$...$$ отдельной строкой).",
  "Не выдумывай факты, цифры, цитаты и ссылки. Если не уверен или данных не хватает — так и скажи.",
  // The chat opens HTML answers in the Canvas, an isolated frame beside it (see chat/artifacts.tsx).
  "Если просят сделать игру, сайт, лендинг, анимацию, калькулятор, визуализацию или другое мини-приложение — пиши один " +
    "самодостаточный HTML-файл (весь CSS и JS внутри) в блоке ```html: оно сразу откроется в Холсте рядом с чатом, " +
    "где его можно запустить, дорабатывать версиями и отправить друзьям по ссылке. " +
    "Делай красиво и рабочим с первого раза: современный дизайн, адаптивность, управление с клавиатуры и касанием. " +
    "Не используй внешние картинки — рисуй через CSS, SVG, Canvas или эмодзи. Дай странице понятный <title>. " +
    "Когда просят доработать такое приложение — присылай обновлённый файл целиком (не кусками), коротко сказав, что изменилось.",
  // Presentations open in the same Canvas; its «Печать / PDF» button saves them as PDF, one slide per page.
  "Если просят презентацию или слайды — сделай её таким же HTML-файлом: слайды 16:9 по одному на экране, листание " +
    "стрелками, кнопками и свайпом, номер слайда, плавные переходы. На слайде — крупный заголовок и мало текста " +
    "(тезисы, цифры, схемы и графики через SVG), продуманная цветовая тема, титульный и итоговый слайды. Добавь " +
    "@media print, где все слайды показаны подряд, каждый на отдельной странице (@page { size: 16in 9in; margin: 0 }), " +
    "без кнопок — так её сохраняют в PDF. Если число слайдов не названо — 8–10.",
].join("\n");

/** Personal instructions from settings: who the user is and how they like answers. */
export interface Instructions {
  about: string;
  style: string;
}

/** The user's instructions as system prompt lines (empty when there are none). */
export function instructionLines({ about, style }: Instructions): string[] {
  const lines: string[] = [];
  if (about) lines.push("Пользователь рассказал о себе (учитывай это, но не пересказывай без просьбы):", about);
  if (style) lines.push("Как пользователь просит отвечать (соблюдай, если это не мешает задаче):", style);
  return lines;
}

/**
 * MARYX's persona (or the assistant's own instructions, if the chat has one),
 * the user's own instructions and what MARYX remembers about them.
 */
export function maryxSystem(
  model: ModelInfo,
  facts: string[],
  options: { assistantPrompt?: string; instructions?: Instructions; webSearch?: boolean } = {},
): string {
  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const lines = [
    ...(options.assistantPrompt
      ? [options.assistantPrompt]
      : [
          "Ты — MARYX, собственный искусственный интеллект платформы MARYX Ai: дружелюбный, честный и полезный собеседник.",
          ANSWER_STYLE,
          // The chat draws, edits photos and makes videos itself (see chat/route.ts); a text answer can't.
          "Ты умеешь рисовать картинки, обрабатывать фото, снимать видео и оживлять фото. Если просят обработать, изменить " +
            "или оживить фото, а фото не приложено, попроси прикрепить его (скрепка) и написать, что сделать. " +
            "Видео снимается по просьбе «сними видео…» или в режиме «Видео». Не делай вид, что обработал фото или снял видео, текстом.",
        ]),
    maryxOnly()
      ? // Our own AI to its users: what it runs on stays behind the scenes (it can't be fully guaranteed).
        // An assistant keeps its own persona; only the models behind it stay unnamed.
        options.assistantPrompt
        ? "Не называй модели, компании и сервисы, на которых работаешь, и не обсуждай их. Если спросят, на чём ты работаешь, отвечай, что на платформе MARYX Ai."
        : "Ты — MARYX, собственный ИИ платформы MARYX Ai. Не называй модели, компании и сервисы, на которых работаешь, и не обсуждай их. " +
          "Если спросят, какая ты модель или кто тебя создал, отвечай, что ты MARYX — ИИ платформы MARYX Ai, который сам подбирает лучшие технологии под каждую задачу."
      : `Для каждого сообщения MARYX сам выбирает подходящую модель; этот ответ формирует ${model.label}. Если спросят, какая модель отвечает, скажи это честно.`,
    `Сегодня ${date}.`,
  ];
  if (options.webSearch) {
    lines.push("Тебе доступен поиск в интернете: для свежих фактов опирайся на найденные страницы и ссылайся на них.");
  }
  if (options.instructions) lines.push(...instructionLines(options.instructions));
  if (facts.length) {
    lines.push(
      "Что ты знаешь о пользователе (учитывай в ответах, но не перечисляй без просьбы):",
      ...facts.map((f) => `- ${f}`),
    );
  }
  return lines.join("\n");
}

// ---------- Memory ----------

const MAX_FACTS = 50;

const MAX_INSTRUCTION_CHARS = 1500;

/** Memory switch and personal instructions in one read. */
export async function userPrefs(userId: string): Promise<{ memory: boolean; instructions: Instructions }> {
  const db = await getDb();
  const [row] = await db.select().from(schema.userPref).where(eq(schema.userPref.userId, userId));
  return { memory: row?.memory ?? true, instructions: { about: row?.about ?? "", style: row?.style ?? "" } };
}

export async function memoryEnabled(userId: string): Promise<boolean> {
  return (await userPrefs(userId)).memory;
}

export async function setInstructions(userId: string, input: Instructions): Promise<Instructions> {
  const clean = (t: string) => t.replace(/\r\n?/g, "\n").trim().slice(0, MAX_INSTRUCTION_CHARS);
  const values = { about: clean(input.about), style: clean(input.style) };
  const db = await getDb();
  await db
    .insert(schema.userPref)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.userPref.userId, set: values });
  return values;
}

export async function setMemoryEnabled(userId: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db
    .insert(schema.userPref)
    .values({ userId, memory: enabled })
    .onConflictDoUpdate({ target: schema.userPref.userId, set: { memory: enabled } });
}

export async function listFacts(userId: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.memory)
    .where(eq(schema.memory.userId, userId))
    .orderBy(asc(schema.memory.createdAt));
}

export async function deleteFacts(userId: string, ids?: string[]): Promise<void> {
  const db = await getDb();
  await db
    .delete(schema.memory)
    .where(and(eq(schema.memory.userId, userId), ...(ids ? [inArray(schema.memory.id, ids)] : [])));
}

/** Messages that probably say something lasting about the user. */
const PERSONAL = /(меня зовут|мо[её] имя|я работаю|я живу|мне \d+ (год|лет)|я (из|учусь|занимаюсь|программист|дизайнер|предприниматель|студент|врач|учитель|маркетолог)|запомни|забудь|у меня есть|мо(й|я|ё|и) (муж|жена|сын|дочь|дети|ребён|день рождения|бизнес|сайт|компани|работа|професси|хобби)|я предпочитаю|я люблю|я не люблю|мне нравится|обращайся ко мне|называй меня|my name is|i work|i live|remember that|forget that)/i;

export function mightHaveFacts(text: string): boolean {
  return PERSONAL.test(text);
}

/**
 * Updates the user's memory from one message with a fast model: adds new
 * lasting facts and removes ones the user corrected or asked to forget.
 */
export async function rememberFrom(userId: string, userText: string, meter: Meter): Promise<void> {
  const facts = await listFacts(userId);
  const out = await quickText(
    "Ты обновляешь долговременную память ассистента о пользователе. Верни ТОЛЬКО JSON без пояснений: " +
      '{"add": ["короткий факт о пользователе в третьем лице"], "remove": [номера фактов]}. ' +
      "Добавляй только устойчивые факты (имя, работа, город, семья, предпочтения, цели), не разовые просьбы. " +
      "Удаляй факты, которые пользователь опроверг или попросил забыть. Если менять нечего — {\"add\": [], \"remove\": []}.",
    `Что уже известно:\n${facts.map((f, i) => `${i + 1}. ${f.text}`).join("\n") || "(ничего)"}\n\n` +
      `Сообщение пользователя:\n${userText.slice(0, 4000)}`,
    30_000,
    meter,
  );
  const json = out.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return;
  let parsed: { add?: unknown; remove?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  const remove = (Array.isArray(parsed.remove) ? parsed.remove : [])
    .map((n) => facts[Number(n) - 1]?.id)
    .filter((id): id is string => Boolean(id));
  const known = new Set(facts.map((f) => f.text.toLowerCase()));
  const add = (Array.isArray(parsed.add) ? parsed.add : [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 200))
    .filter((t) => t && !known.has(t.toLowerCase()))
    .slice(0, 5);

  const db = await getDb();
  if (remove.length) await deleteFacts(userId, remove);
  if (add.length) {
    await db.insert(schema.memory).values(add.map((text) => ({ id: crypto.randomUUID(), userId, text })));
  }
  // Keep the newest facts only.
  const all = await listFacts(userId);
  if (all.length > MAX_FACTS) await deleteFacts(userId, all.slice(0, all.length - MAX_FACTS).map((f) => f.id));
}

// ---------- Titles and follow-ups ----------

/** A short name for a new chat from its first message, or null if the model gave none. */
export async function suggestTitle(text: string, fileNames: string[], meter: Meter): Promise<string | null> {
  const out = await quickText(
    "Придумай короткое название чата (2–6 слов) по первому сообщению пользователя. " +
      "Язык — как у сообщения. Верни только название: без кавычек, эмодзи и точки в конце.",
    [text.slice(0, 2000), ...fileNames.map((n) => `[файл: ${n}]`)].filter(Boolean).join("\n"),
    15_000,
    meter,
  );
  const title = out
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean)
    ?.replace(/^(название|title)\s*:\s*/i, "")
    .replace(/^["'«»“”*#\s]+|["'«»“”*.\s]+$/g, "")
    .slice(0, 80);
  return title || null;
}

const ENHANCE_GUIDE: Record<"image" | "video" | "edit" | "animate", string> = {
  image:
    "Ты — эксперт по промптам для генерации изображений. Преврати идею пользователя в один подробный промпт " +
    "(60–120 слов) на языке идеи: главный объект и его детали, окружение, стиль, освещение, композиция и ракурс, " +
    "цветовая палитра, атмосфера, качество (например, «высокая детализация»).",
  video:
    "Ты — эксперт по промптам для генерации видео. Преврати идею пользователя в один подробный промпт " +
    "(60–120 слов) на языке идеи: что происходит в кадре от начала до конца, движение объектов и камеры, темп, " +
    "освещение, стиль съёмки, атмосфера и звук.",
  edit:
    "Ты — эксперт по обработке фото. Преврати просьбу пользователя в точную инструкцию для ИИ-редактора фото " +
    "(30–70 слов) на языке просьбы: что именно изменить и как, и что оставить без изменений (лицо, позу, фон — " +
    "если о них не просили). Результат должен выглядеть естественно.",
  animate:
    "Ты — эксперт по видео. Преврати просьбу пользователя в инструкцию для ИИ, который оживляет фото в короткое " +
    "видео (30–70 слов) на языке просьбы: какое движение у человека или объектов, движение камеры, атмосфера. " +
    "Лицо и сцена должны остаться как на фото, движение — естественным.",
};

/**
 * A short idea made into a detailed prompt for an image or video model ("✨ Улучшить"):
 * for a new picture or clip, or for what to do with the user's photo.
 */
export async function enhancePrompt(
  kind: "image" | "video",
  idea: string,
  withPhoto: boolean,
  meter: Meter,
): Promise<string> {
  const guide = ENHANCE_GUIDE[withPhoto ? (kind === "image" ? "edit" : "animate") : kind];
  const out = await quickText(
    `${guide} Сохрани смысл и всё, о чём просил пользователь; не добавляй ничего, что ему противоречит. ` +
      "Если идея уже подробная — улучши её, почти не удлиняя. Верни только сам промпт: без пояснений, кавычек, заголовков и списков.",
    idea.slice(0, 2000),
    25_000,
    meter,
  );
  return out
    .replace(/^\s*(промпт|prompt|инструкция)\s*:\s*/i, "")
    .replace(/^["'«»“”*\s]+|["'«»“”*\s]+$/g, "")
    .slice(0, 1500);
}

// ---------- Scheduled tasks ----------

/**
 * One run of a scheduled task («Задачи»): MARYX does what it was asked to do
 * ahead of time, searching the web when the task needs fresh facts. Nobody is
 * there to answer a question, so it doesn't ask one.
 */
export async function runScheduledPrompt(
  task: { title: string; prompt: string; search: boolean },
  meter: Meter,
  now: string,
): Promise<{ text: string; sources: Source[]; model: ModelInfo }> {
  const plan = await planRoute({
    text: task.prompt,
    hasImages: false,
    hasDocuments: false,
    deepThinking: false,
    webSearch: task.search,
    ownKey: meter.paidBy === "byok" && Boolean(meter.key),
  });
  const system = [
    `Ты — MARYX. Сейчас ты сам выполняешь задачу по расписанию «${task.title}», которую пользователь поручил тебе заранее. ` +
      "Его нет рядом, поэтому не задавай уточняющих вопросов — сделай лучшее, что можно, и сразу дай результат.",
    `Сейчас у пользователя: ${now}.`,
    "Начни с короткого заголовка. Если это слежение за новостями, ценами или упоминаниями и ничего нового не нашлось — так и скажи в одном-двух предложениях.",
    ANSWER_STYLE,
  ].join("\n");
  return callModels([plan.model, ...plan.fallbacks].slice(0, 2), system, task.prompt, 120_000, meter, {
    webSearch: plan.webSearch,
    maxTokens: 4000,
  });
}

const PLACES_SYSTEM =
  "Ты — MARYX, гид по городу. Тебе дают вопрос пользователя и список настоящих мест рядом с ним из OpenStreetMap " +
  "(номер, название, тип, расстояние, адрес, часы работы). Выбери из списка до 5 мест, которые лучше всего подходят под " +
  "вопрос, и коротко объясни выбор. Советуй ТОЛЬКО места из списка: не придумывай другие места, рейтинги, отзывы, цены " +
  "и блюда — их в списке нет. Если часы работы известны, учитывай текущее время. Если подходящего ничего нет, честно скажи. " +
  'Ответь строго в JSON без блока кода: {"answer": "1–3 предложения по-русски", "picks": [{"n": номер, "why": "почему, до 15 слов"}]}';

/**
 * «Карты»: MARYX answers "where to go" from the real places around the user
 * (never invented ones): a short answer and the places it picked, by id.
 */
export async function recommendPlaces(
  input: { question: string; near: string; now: string; places: Place[] },
  meter: Meter,
): Promise<{ answer: string; picks: { id: string; why: string }[] }> {
  const list = input.places.map((p, i) =>
    [`${i + 1}. ${p.name}`, p.kind, `${p.distance} м`, p.address, p.hours && `часы: ${p.hours}`].filter(Boolean).join(" · "),
  );
  const ask = [`Вопрос: ${input.question}`, `Где: ${input.near}. Сейчас: ${input.now}.`, `Места рядом:\n${list.join("\n")}`].join("\n\n");
  const { text } = await quickCall(PLACES_SYSTEM, ask, 60_000, meter, { maxTokens: 1200 });
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  try {
    const parsed = JSON.parse(json ?? "") as { answer?: unknown; picks?: unknown };
    const picks = (Array.isArray(parsed.picks) ? parsed.picks : [])
      .map((p: { n?: unknown; why?: unknown }) => ({ place: input.places[Number(p?.n) - 1], why: typeof p?.why === "string" ? p.why : "" }))
      .filter((p) => p.place)
      .map((p) => ({ id: p.place.id, why: p.why.slice(0, 200) }));
    const unique = picks.filter((p, i) => picks.findIndex((q) => q.id === p.id) === i).slice(0, 5);
    return { answer: typeof parsed.answer === "string" ? parsed.answer.trim() : "", picks: unique };
  } catch {
    // Not JSON after all: the words are still an answer.
    return { answer: text.replace(/```\w*/g, "").trim(), picks: [] };
  }
}

/** What «Холст для текстов» can do with a document or its selected part, in one click. */
export const REWRITE_TASKS = {
  improve: "Улучши текст: сделай его яснее, живее и убедительнее, убери повторы, воду и канцелярит. Смысл и факты не меняй.",
  shorter: "Сократи текст примерно вдвое: оставь главное, убери второстепенное.",
  longer: "Раскрой текст подробнее: добавь пояснения, примеры и детали — примерно в полтора-два раза длиннее.",
  fix: "Исправь орфографические, пунктуационные и грамматические ошибки и опечатки. Больше ничего не меняй: ни слова, ни стиль, ни порядок.",
  simpler: "Перепиши проще и понятнее, как для новичка: короткие предложения, без сложных терминов.",
  formal: "Перепиши в официально-деловом стиле: вежливо, точно, без разговорных оборотов.",
  friendly: "Перепиши в тёплом, дружелюбном тоне, как будто пишешь хорошему знакомому.",
  emoji: "Добавь уместные эмодзи, чтобы текст стал живее. Сами слова не меняй.",
  english: "Переведи текст на английский язык — естественно, как написал бы носитель.",
} as const;

export type RewriteTask = keyof typeof REWRITE_TASKS;

const REWRITE_SYSTEM =
  "Ты — редактор текстов MARYX. Тебе дают текст (или его фрагмент) и задачу. Выполни задачу и верни ТОЛЬКО новый вариант " +
  "текста: без пояснений, без вступлений вроде «Вот исправленный текст», без кавычек и без блока кода вокруг. Сохраняй язык " +
  "оригинала (если задача не про перевод) и разметку Markdown: заголовки, списки, жирный шрифт, таблицы. Если дан весь " +
  "документ — перепиши только фрагмент, чтобы он ложился в документ по стилю и смыслу.";

/**
 * «Холст для текстов»: a strong model rewrites a document, or the selected
 * fragment of it (`document` is then the whole text, for context), as asked.
 */
export async function rewriteText(input: { text: string; task: string; document?: string }, meter: Meter): Promise<string> {
  const ask = [
    input.document ? `Весь документ (для контекста, его не переписывай):\n<<<\n${excerpt(input.document, 12_000)}\n>>>` : "",
    `Задача: ${input.task}`,
    `${input.document ? "Фрагмент" : "Текст"}, который нужно переписать:\n<<<\n${input.text}\n>>>`,
  ];
  const { text } = await quickCall(REWRITE_SYSTEM, ask.filter(Boolean).join("\n\n"), 100_000, meter, {
    strong: true,
    // Room for a text twice as long ("Подробнее").
    maxTokens: Math.min(16_000, input.text.length + 1000),
  });
  return text
    .replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, "$1")
    .replace(/^<<<\n?|\n?>>>$/g, "")
    .trim();
}

/** Keeps the start and the end of a long text for a short prompt. */
function excerpt(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max * 0.6)}\n…\n${text.slice(-max * 0.4)}`;
}

/** Up to three short follow-up questions the user might ask next. */
export async function suggestFollowUps(question: string, answer: string, meter: Meter): Promise<string[]> {
  const out = await quickText(
    "Предложи до трёх коротких вопросов или просьб, которые пользователь мог бы написать следующими, " +
      "чтобы продолжить разговор: углубиться, применить ответ на практике, пойти дальше. " +
      "Пиши от лица пользователя, на его языке, каждый до 60 символов. " +
      'Верни ТОЛЬКО JSON-массив строк, например ["Покажи пример", "А как сделать быстрее?"]. ' +
      "Если продолжать нечего (благодарность, прощание) — [].",
    `Вопрос пользователя:\n${excerpt(question, 1500)}\n\nОтвет ассистента:\n${excerpt(answer, 3000)}`,
    15_000,
    meter,
  );
  const json = out.match(/\[[\s\S]*\]/)?.[0];
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 1 && t.length <= 100)
    .slice(0, 3);
}
