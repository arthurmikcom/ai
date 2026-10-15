// Nexus — the platform's own AI. It isn't a separately trained model: for
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
  ],
  smart: [
    ["anthropic", "claude-sonnet-5-5"],
    ["openrouter", "anthropic/claude-sonnet-5.5"],
    ["openai", "gpt-6.1-sol"],
    ["openrouter", "openai/gpt-6.1-sol"],
    ["google", "gemini-3.1-pro-preview"],
    ["openrouter", "google/gemini-3.1-pro-preview"],
    ["openrouter", "deepseek/deepseek-v4-pro"],
  ],
  deep: [
    ["anthropic", "claude-opus-5-5"],
    ["openrouter", "anthropic/claude-opus-5.5"],
    ["openai", "gpt-6-astra"],
    ["openrouter", "openai/gpt-6-astra"],
    ["google", "gemini-3.1-pro-preview"],
    ["openrouter", "google/gemini-3.1-pro-preview"],
  ],
};

// Note: \b doesn't work next to Cyrillic letters in JS, so word edges are spelled out.
const IMAGE_WORDS = /(картин|изображени|рисун|иллюстрац|логотип|постер|обложк|аватар|арт(?![а-яё])|фото|обои)/i;

/** "Нарисуй…", "сгенерируй картинку…", "draw a…". */
export function wantsImage(text: string): boolean {
  const t = text.trim();
  if (/^(нарисуй|нарисуйте|изобрази|изобразите)(?![а-яё])/i.test(t)) return true;
  if (/^(draw|paint|generate an? (image|picture|illustration))\b/i.test(t)) return true;
  return /(сгенерируй|сгенерировать|создай|создать|сделай|сделать|нарисуй)/i.test(t.slice(0, 80)) && IMAGE_WORDS.test(t.slice(0, 120));
}

/** Questions about today's world, which a model can't know without searching. */
function wantsSearch(text: string): boolean {
  return /(новост|сегодня|вчера|прямо сейчас|на данный момент|последн(ие|яя|ий|их) (новост|верси|событи)|свеж|актуальн|курс (доллар|евро|рубл|валют|биткоин|акци)|погод|сколько стоит сейчас|что нового|кто выиграл|результат(ы)? матч|в этом году|202[6-9]|latest news|today|right now|current price|weather)/i.test(
    text,
  );
}

function needsSmart(text: string, hasDocuments: boolean): boolean {
  if (hasDocuments || text.length > 700) return true;
  return /(```|(?<![а-яё])код|функци|скрипт|программ|python|javascript|typescript|\bjava\b|c\+\+|\bsql\b|regex|регулярн|баг|ошибк[а-яё]* в код|компил|\bapi\b|html|css|react|алгоритм|подробно|детально|проанализируй|сравни|стратеги|бизнес-план|эссе|статью|докажи|реши задачу|рассчитай|переведи текст|резюме|договор)/i.test(
    text,
  );
}

export interface NexusPlan {
  model: ModelInfo;
  webSearch: boolean;
}

/** Picks the model (and search) for one message. */
export async function planRoute(input: {
  text: string;
  hasImages: boolean;
  hasDocuments: boolean;
  deepThinking: boolean;
  webSearch: boolean;
}): Promise<NexusPlan> {
  const { models } = await listModels("chat");
  const available = models.filter((m) => m.provider !== "nexus");
  if (available.length === 0) throw new Error("Nexus не может ответить: не подключена ни одна модель.");

  const search = isConfigured("openrouter") && (input.webSearch || wantsSearch(input.text));
  const tier: Tier = input.deepThinking ? "deep" : needsSmart(input.text, input.hasDocuments) ? "smart" : "fast";
  // Fall back to the neighbouring tiers when the preferred one has nothing available.
  const order: Tier[] = tier === "fast" ? ["fast", "smart", "deep"] : tier === "smart" ? ["smart", "deep", "fast"] : ["deep", "smart", "fast"];

  const usable = (m: ModelInfo) => (!input.hasImages || m.vision) && (!search || m.provider === "openrouter");
  for (const t of order) {
    for (const [provider, id] of TIERS[t]) {
      const m = available.find((x) => x.provider === provider && x.id === id);
      if (m && usable(m)) return { model: m, webSearch: search };
    }
  }
  // Nothing from our lists (e.g. only Ollama): the first featured model that fits.
  const any = available.find((m) => m.featured && usable(m)) ?? available.find(usable) ?? available[0];
  return { model: any, webSearch: search && any.provider === "openrouter" };
}

/**
 * Nexus's persona (or the assistant's own instructions, if the chat has one),
 * plus what it remembers about the user.
 */
export function nexusSystem(model: ModelInfo, facts: string[], assistantPrompt?: string): string {
  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const lines = [
    ...(assistantPrompt
      ? [assistantPrompt]
      : [
          "Ты — Nexus, собственный искусственный интеллект платформы Nexus AI: дружелюбный, точный и полезный.",
          "Отвечай на языке пользователя. Используй Markdown, когда это помогает: списки, таблицы, блоки кода с указанием языка.",
        ]),
    `Для каждого сообщения Nexus сам выбирает подходящую модель; этот ответ формирует ${model.label}. Если спросят, какая модель отвечает, скажи это честно.`,
    `Сегодня ${date}.`,
  ];
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

export async function memoryEnabled(userId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select().from(schema.userPref).where(eq(schema.userPref.userId, userId));
  return row?.memory ?? true;
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
  const { model } = await planRoute({ text: "", hasImages: false, hasDocuments: false, deepThinking: false, webSearch: false });
  const request: ChatRequest = {
    provider: model.provider,
    model: model.id,
    system:
      "Ты обновляешь долговременную память ассистента о пользователе. Верни ТОЛЬКО JSON без пояснений: " +
      '{"add": ["короткий факт о пользователе в третьем лице"], "remove": [номера фактов]}. ' +
      "Добавляй только устойчивые факты (имя, работа, город, семья, предпочтения, цели), не разовые просьбы. " +
      "Удаляй факты, которые пользователь опроверг или попросил забыть. Если менять нечего — {\"add\": [], \"remove\": []}.",
    messages: [
      {
        role: "user",
        content:
          `Что уже известно:\n${facts.map((f, i) => `${i + 1}. ${f.text}`).join("\n") || "(ничего)"}\n\n` +
          `Сообщение пользователя:\n${userText.slice(0, 4000)}`,
      },
    ],
  };
  let out = "";
  for await (const event of streamChat(request, AbortSignal.timeout(30_000))) {
    if (event.type === "text") out += event.text;
  }
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
