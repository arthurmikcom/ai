// MARYX — the platform's own AI. It isn't a separately trained model: for
// every message it picks the best available real model (fast and cheap for
// simple questions, strong for code and long tasks, the most powerful one
// for "think deeper"), turns on web search or drawing when the request calls
// for it, speaks with its own persona and remembers facts about the user.

import { and, asc, eq, inArray } from "drizzle-orm";
import type { ChatRequest, ModelInfo, ProviderId } from "@/lib/types";
import { streamChat } from "./chat";
import { isConfigured } from "./config";
import { getDb, schema } from "./db";
import { listModels } from "./models";

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

/** Questions about the world right now, which a model can't know without searching. */
function wantsSearch(text: string): boolean {
  return /(новост|что нового|что (произошло|случилось)|курс (доллар|евро|рубл|юан|валют|биткоин|акци)|погод[аеуы]|кто выиграл|результат(ы)? (матча|игры|выборов)|latest news|current price|weather)/i.test(
    text.slice(0, 300),
  );
}

function needsSmart(text: string, hasDocuments: boolean): boolean {
  if (hasDocuments || text.length > 700) return true;
  return /(```|(?<![а-яё])код|функци|скрипт|программ|python|javascript|typescript|\bjava\b|c\+\+|\bsql\b|regex|регулярн|баг|ошибк[а-яё]* в код|компил|\bapi\b|html|css|react|алгоритм|подробно|детально|проанализируй|сравни|стратеги|бизнес-план|эссе|статью|докажи|реши задачу|рассчитай|переведи текст|резюме|договор)/i.test(
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
}): Promise<MaryxPlan> {
  const { models } = await listModels("chat");
  // Only server models: the browser ones run on the visitor's device, not here.
  const available = models.filter((m) => m.provider !== "maryx" && !m.local);
  if (available.length === 0) throw new Error("MARYX не может ответить: не подключена ни одна модель.");

  const search = isConfigured("openrouter") && (input.webSearch || wantsSearch(input.text));
  let tier: Tier = input.deepThinking ? "deep" : needsSmart(input.text, input.hasDocuments) ? "smart" : "fast";
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

/** The fast model MARYX uses for its own small jobs (memory, titles, suggestions). */
async function quickText(system: string, user: string, timeoutMs: number): Promise<string> {
  const plan = await planRoute({ text: "", hasImages: false, hasDocuments: false, deepThinking: false, webSearch: false });
  const signal = AbortSignal.timeout(timeoutMs);
  // One fallback (from another vendor) if the first model is down.
  const [first, second] = [plan.model, ...plan.fallbacks];
  for (const model of [first, second]) {
    if (!model) break;
    try {
      let out = "";
      const request: ChatRequest = {
        provider: model.provider,
        model: model.id,
        system,
        light: true,
        messages: [{ role: "user", content: user }],
      };
      for await (const event of streamChat(request, signal)) {
        if (event.type === "text") out += event.text;
      }
      // A self-hosted server without a reasoning parser leaves the model's thinking in the text.
      return out.replace(/^[\s\S]*<\/think>/, "").trim();
    } catch (err) {
      if (model === second || !second || signal.aborted) throw err;
    }
  }
  return "";
}

/** How answers should look, for MARYX and for every other model in the chat. */
export const ANSWER_STYLE = [
  "Отвечай на языке пользователя. Сразу к сути, без вступлений вроде «Конечно!» или «Отличный вопрос».",
  "Длина — по задаче: на простой вопрос хватит пары предложений, сложный разбери по шагам с заголовками и списками.",
  "Markdown: таблицы для сравнений, код в блоках с указанием языка, формулы в LaTeX ($...$ в строке, $$...$$ отдельной строкой).",
  "Не выдумывай факты, цифры, цитаты и ссылки. Если не уверен или данных не хватает — так и скажи.",
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
        ]),
    `Для каждого сообщения MARYX сам выбирает подходящую модель; этот ответ формирует ${model.label}. Если спросят, какая модель отвечает, скажи это честно.`,
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
export async function rememberFrom(userId: string, userText: string): Promise<void> {
  const facts = await listFacts(userId);
  const out = await quickText(
    "Ты обновляешь долговременную память ассистента о пользователе. Верни ТОЛЬКО JSON без пояснений: " +
      '{"add": ["короткий факт о пользователе в третьем лице"], "remove": [номера фактов]}. ' +
      "Добавляй только устойчивые факты (имя, работа, город, семья, предпочтения, цели), не разовые просьбы. " +
      "Удаляй факты, которые пользователь опроверг или попросил забыть. Если менять нечего — {\"add\": [], \"remove\": []}.",
    `Что уже известно:\n${facts.map((f, i) => `${i + 1}. ${f.text}`).join("\n") || "(ничего)"}\n\n` +
      `Сообщение пользователя:\n${userText.slice(0, 4000)}`,
    30_000,
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
export async function suggestTitle(text: string, fileNames: string[]): Promise<string | null> {
  const out = await quickText(
    "Придумай короткое название чата (2–6 слов) по первому сообщению пользователя. " +
      "Язык — как у сообщения. Верни только название: без кавычек, эмодзи и точки в конце.",
    [text.slice(0, 2000), ...fileNames.map((n) => `[файл: ${n}]`)].filter(Boolean).join("\n"),
    15_000,
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

/** Keeps the start and the end of a long text for a short prompt. */
function excerpt(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max * 0.6)}\n…\n${text.slice(-max * 0.4)}`;
}

/** Up to three short follow-up questions the user might ask next. */
export async function suggestFollowUps(question: string, answer: string): Promise<string[]> {
  const out = await quickText(
    "Предложи до трёх коротких вопросов или просьб, которые пользователь мог бы написать следующими, " +
      "чтобы продолжить разговор: углубиться, применить ответ на практике, пойти дальше. " +
      "Пиши от лица пользователя, на его языке, каждый до 60 символов. " +
      'Верни ТОЛЬКО JSON-массив строк, например ["Покажи пример", "А как сделать быстрее?"]. ' +
      "Если продолжать нечего (благодарность, прощание) — [].",
    `Вопрос пользователя:\n${excerpt(question, 1500)}\n\nОтвет ассистента:\n${excerpt(answer, 3000)}`,
    15_000,
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
