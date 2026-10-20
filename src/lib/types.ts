// Shared types used by both the browser and the server.

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "deepseek"
  | "xai"
  /** Qwen through Alibaba Cloud Model Studio (DashScope). */
  | "qwen"
  | "ollama"
  /** Our own OpenAI-compatible server (vLLM, SGLang, LM Studio…), e.g. open Qwen weights on a GPU. */
  | "custom"
  /** Open Qwen models that run in the visitor's browser (WebGPU): free, no keys. */
  | "browser"
  | "replicate"
  /** Higgsfield's API: Genjutsu motion transfer for «Тренд» (a person of a video becomes someone else, move for move). */
  | "higgsfield"
  /** The site's own GPU running ComfyUI: free open models (FLUX, Wan) for pictures and video. */
  | "comfy"
  /** Pollinations' public image endpoint: open models (FLUX), no key and no fee — the free plan's pictures. */
  | "pollinations"
  /** Our own AI: picks the best real model for each message. */
  | "maryx";

export type Capability = "chat" | "image" | "video";

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  label: string;
  description?: string;
  capability: Capability;
  /** Shown at the top of the picker; the rest sit under "all models". */
  featured: boolean;
  /** Accepts image attachments in chat. */
  vision?: boolean;
  /** Supports the "think deeper" toggle. */
  reasoning?: boolean;
  /** Can look things up on the web while answering. */
  search?: boolean;
  /** Runs in the visitor's browser instead of on a server (MARYX when no keys are set). */
  local?: boolean;
  /** One-time download for a browser model, in MB. */
  downloadMB?: number;
  /** Image models: can edit the user's own photo; video models: can animate it (as the first frame). */
  photoEdit?: boolean;
  /** Video models: can also end on a given picture (a transition between two frames). */
  lastFrame?: boolean;
  /** MARYX video: can repeat a whole video's movement with someone else in it (motion transfer, «Тренд»). */
  motion?: boolean;
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  /** Set up on the server. */
  configured: boolean;
  /** Not on the server, but this user's own key covers it (OpenRouter, BYOK). */
  ownKey?: boolean;
  envVar: string;
  signupUrl: string;
  capabilities: Capability[];
  note: string;
}

export interface ModelsResponse {
  providers: ProviderStatus[];
  models: ModelInfo[];
  /** Only MARYX is offered (see MeResponse.maryxOnly). */
  maryxOnly?: boolean;
}

// ---------- Chat ----------

/** An image attached to a chat message. */
export interface Attachment {
  mime: string;
  /** Base64 without the data: prefix (only while uploading). */
  data?: string;
  /** Where the stored copy can be read (/api/files/…). */
  url?: string;
  name?: string;
  /** A file uploaded beforehand (a whole video, in parts): its storage key, no data. */
  key?: string;
  /** For MARYX only, not shown (a video's frames on one sheet). */
  hidden?: boolean;
  /** Browser only: a video still uploading (0–100), and a local copy to show meanwhile. */
  progress?: number;
  preview?: string;
}

/** A web page the answer is based on (web search). */
export interface Source {
  url: string;
  title?: string;
}

/** What the server sends to the model provider: always inline bytes. */
export interface InlineImage {
  mime: string;
  data: string;
}

/** A file uploaded with a message: an image or a document (PDF, Word, Excel…). */
export interface InlineFile extends InlineImage {
  name?: string;
  /** Uploaded beforehand (a whole video): its storage key; `data` is then empty. */
  key?: string;
  /** For MARYX only, not shown in the chat. */
  hidden?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  attachments?: Attachment[];
  provider?: ProviderId;
  model?: string;
  error?: string;
  /** "limit" when the daily limit stopped this message (not stored). */
  errorCode?: string;
  notice?: string;
  /** Pages found by web search for this answer. */
  sources?: Source[];
  /** "maryx" when MARYX chose the model (provider/model then name the real one). */
  via?: "maryx";
  /** Follow-up questions MARYX suggests after this answer. */
  suggestions?: string[];
  /** A video answer: its gallery item, made in the background. */
  mediaId?: string;
  /** Browser only: the server refused this message, so it was never saved. */
  unsent?: boolean;
  /** Browser only: what the pending answer is busy with (drawing, filming, searching). */
  generating?: "image" | "video" | "search";
  /** Browser only: progress of a model running on this device (download, start). */
  status?: string;
  createdAt: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  assistantId?: string;
  /** «Временный чат»: not in the history or MARYX's memory; deleted when left. */
  temporary?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Chat extends ChatSummary {
  messages: ChatMessage[];
}

export interface Assistant {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  provider?: ProviderId;
  model?: string;
  createdAt: number;
}

/** How the browser asks for the next answer. */
export interface SendOptions {
  deepThinking: boolean;
  /** Draw a picture instead of answering with text. */
  image?: boolean;
  /** Make a video (from the words, or the attached photo) instead of answering with text. */
  video?: boolean;
  /** Video: how the camera moves (an id of CAMERA_MOTIONS). */
  camera?: string;
  /** Picture: its look (an id of IMAGE_STYLES). */
  style?: string;
  /** Let the model search the web. */
  webSearch?: boolean;
  /** Deep research: several web searches first, then a report with sources. */
  research?: boolean;
  /** Консилиум: several strong models answer, MARYX combines the best of them. */
  council?: boolean;
  /** «Ответить лучше»: the last answer again, from a stronger model than the one that gave it (MARYX). */
  better?: boolean;
  /** Answer with this model in the browser (see client/local-ai.ts) instead of the server. */
  local?: { model: string };
}

/** Browser → /api/chat. The server loads the history itself. */
export interface ChatSendRequest {
  chatId: string;
  /** Set when this is the first message of a new chat. */
  create?: { assistantId?: string; temporary?: boolean };
  provider: ProviderId;
  model: string;
  deepThinking?: boolean;
  /** Draw a picture from the message instead of answering with text. */
  image?: boolean;
  /** Make a video from the message (and its photo) instead of answering with text. */
  video?: boolean;
  /** Video: how the camera moves (an id of CAMERA_MOTIONS). */
  camera?: string;
  /** Picture: its look (an id of IMAGE_STYLES). */
  style?: string;
  /** Let the model search the web (models with `search`). */
  webSearch?: boolean;
  /** Deep research (MARYX): several web searches first, then a report with sources. */
  research?: boolean;
  /** Консилиум (MARYX): several strong models answer, then one combines the best. */
  council?: boolean;
  /** «Ответить лучше» (MARYX, regenerating): a stronger model than the one that gave the answer. */
  better?: boolean;
  /** The new user message; omitted when regenerating the last answer. */
  message?: { id: string; content: string; attachments?: InlineFile[] };
  /** Id for the assistant message the server will store. */
  answerId: string;
  /** Regenerate: the user message being answered, so a lost one isn't answered by mistake. */
  replyTo?: string;
  /** A corrected question: the id of the chat's last question, which `message` replaces (with its answer). */
  replace?: string;
}

/** Server → model provider adapters. */
export interface ChatRequest {
  provider: ProviderId;
  model: string;
  system?: string;
  deepThinking?: boolean;
  /** Think as little as possible: a small background job (title, suggestions, memory), or an answer short of budget. */
  light?: boolean;
  webSearch?: boolean;
  messages: { role: "user" | "assistant"; content: string; attachments?: InlineImage[] }[];
  /** The user's own OpenRouter key (BYOK) to send this request with. Set on the server only. */
  apiKey?: string;
  /** The most the answer may write, thinking included (what the user's budget or credits cover). Server only. */
  maxTokens?: number;
  /** End-user id passed to OpenRouter for abuse tracking (a hash, not the account id). */
  endUser?: string;
}

/** What one model call used, reported by the provider at the end of a stream. */
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  /** US dollars, when the provider reports it (OpenRouter). */
  cost?: number;
}

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "notice"; text: string }
  | { type: "source"; url: string; title?: string }
  /**
   * MARYX picked a model (and maybe search or drawing) for this answer. With
   * `retry`, the previous model failed before answering and this one starts over.
   */
  | { type: "route"; provider: ProviderId; model: string; search?: boolean; image?: boolean; video?: boolean; retry?: boolean }
  /** A better name for a new chat (may arrive after "done"). */
  | { type: "title"; title: string }
  /** Follow-up questions for the answer (may arrive after "done"). */
  | { type: "suggestions"; items: string[] }
  /** A picture drawn in the chat, and the image model that drew it. */
  | { type: "image"; url: string; mime: string; provider: ProviderId; model: string }
  /** The picture a follow-up edit changes, put on the user's message by the server. */
  | { type: "attached"; messageId: string; url: string; mime: string }
  /** A video answer started: its gallery item, which the browser follows until it's ready. */
  | { type: "media"; item: MediaItem }
  /** A step of the work before the answer (deep research: planning, searching, writing). */
  | { type: "progress"; text: string }
  | { type: "error"; message: string }
  | { type: "done" }
  /** Tokens and cost of the call (server-side only, never sent to the browser). */
  | { type: "usage"; usage: ChatUsage };

// ---------- Image / video generation ----------

export type MediaKind = "image" | "video";

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export interface GenerateRequest {
  kind: MediaKind;
  provider: ProviderId;
  model: string;
  prompt: string;
  aspectRatio: AspectRatio;
  /** Video length in seconds (providers round to what they support). */
  duration?: number;
  /** The user's photos, as the server received them: to edit (images), or the first frame (video, one). */
  images?: InlineImage[];
  /** Video: how the camera moves (an id of CAMERA_MOTIONS). */
  camera?: string;
  /** Video: a visual effect (an id of VIDEO_EFFECTS). */
  effect?: string;
  /** A new picture's look (an id of IMAGE_STYLES). */
  style?: string;
  /** «Мой персонаж»: the user's character drawn in a new scene (its photos go to the model as references). */
  character?: string;
  /**
   * «Тренд»: the first photo is a frame of someone's video; the main person in it
   * becomes the user's character (a saved one, or the second photo).
   */
  recast?: boolean;
  /** The user confirmed the face is theirs, or used with the person's permission (a recast). */
  consent?: boolean;
  /**
   * A recast of several people: who in the frame (as the image model can find
   * them) becomes whom — a saved character, or else the next photo after the frame.
   */
  cast?: { who: string; character?: string }[];
  /** Server only: where each cast person's reference pictures are among `images` (1-based). */
  castPlan?: { who: string; first: number; count: number }[];
  /**
   * «Тренд», move for move: the user's uploaded trend video (its storage key)
   * and its length; `cast` says who becomes whom, `images` holds the photos.
   */
  motion?: { key: string; seconds: number };
}

export type MediaOutput =
  | { type: "base64"; mime: string; data: string }
  | { type: "url"; url: string };

export type GenerateResult =
  /** `cost`: US dollars, when the provider reported it (OpenRouter). */
  | { status: "succeeded"; outputs: MediaOutput[]; cost?: number }
  | { status: "pending"; jobId: string; progress?: number }
  | { status: "failed"; error: string };

export interface MediaFile {
  url: string;
  mime: string;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  prompt: string;
  provider: ProviderId;
  model: string;
  aspectRatio: AspectRatio;
  status: "pending" | "succeeded" | "failed";
  jobId?: string;
  progress?: number;
  error?: string;
  /** "limit" when the daily limit blocked the request (not stored). */
  errorCode?: string;
  files: MediaFile[];
  /** The user's photos it was made from (photo editing). */
  inputs?: MediaFile[];
  /** The character it was drawn with («Мой персонаж»). */
  character?: string;
  /** Video: how it was filmed (to show it and to do it again). */
  camera?: string;
  effect?: string;
  duration?: number;
  createdAt: number;
}

/** «Мой персонаж»: a person (the user, a friend) MARYX draws in any scene from 1–3 photos. */
export interface Character {
  id: string;
  name: string;
  photos: MediaFile[];
  createdAt: number;
}

// ---------- Account ----------

export type UsageKind = "chat" | "image" | "video" | "voice";

export const USAGE_KINDS: UsageKind[] = ["chat", "image", "video", "voice"];

/** Today's usage; `limit: null` means unlimited. */
export type UsageSummary = Record<UsageKind, { used: number; limit: number | null }>;

export type PlanId = "free" | "plus" | "pro" | "ultra";

/** The plans one pays for (a subscription). */
export type PaidPlanId = Exclude<PlanId, "free">;

/**
 * How a request is paid for: the daily limits of the user's plan (or an
 * admin's unlimited use), prepaid credits once those are used up, or the
 * user's own OpenRouter key (BYOK).
 */
export type PaidBy = PlanId | "admin" | "credits" | "byok";

/** What a recorded AI cost was for; "background" is MARYX's own small jobs (titles, follow-ups, memory). */
export type CostKind = UsageKind | "background";

/** A pack of AI credits on sale, with its price for each configured payment method. */
export interface CreditPack {
  id: string;
  credits: number;
  /** "199 ₽" (ЮKassa), when configured. */
  rub?: string;
  /** "$2.49" (Stripe), when configured. */
  usd?: string;
}

export interface PlanInfo {
  id: PlanId;
  /** Where the paid period came from. */
  provider?: "stripe" | "yookassa" | "promo";
  /** End of the paid period (ms). */
  periodEnd?: number;
  /** True when it won't renew (cancelled, or a promo period). */
  endsAtPeriodEnd?: boolean;
  /** When the next renewal will be charged (ms). */
  renewsAt?: number;
  /** A Stripe subscription still exists (even with a failed payment): manage it in Stripe's portal. */
  stripeLive?: boolean;
  /** YooKassa/Stripe status, e.g. "past_due" after a failed renewal. */
  status?: string;
  /** YooKassa: a card is saved, so auto-renew can be switched back on. */
  cardSaved?: boolean;
  /** YooKassa: the period won't renew by itself — the user can pay again from the pricing page. */
  repay?: boolean;
}

export interface MeResponse {
  user: { id: string; name: string; email: string; image?: string | null };
  admin: boolean;
  plan: PlanInfo;
  usage: UsageSummary;
  /** Today's AI spending against the plan's daily budget, in US dollars (limit null: none). */
  budget: { used: number; limit: number | null };
  /** Prepaid AI credits left. */
  credits: number;
  /** The user's own OpenRouter key (BYOK), if saved: its last characters. */
  ownKey: { hint: string } | null;
  /** Social sign-in methods configured on this server. */
  social: { google: boolean; vk: boolean };
  /** Speech-to-text on the server is available (otherwise the browser's own, if any). */
  voice: { transcribe: boolean };
  /** Users get only our own AI, MARYX: no model choice, no names of the models behind it (SHOW_ALL_MODELS unset). */
  maryxOnly: boolean;
  /** Pictures within the plan come from the free model (the free plan); paid plans and credits draw with GPT Image. */
  freeImages: boolean;
}

/** What /api/billing/plans tells the pricing page. */
export interface BillingOptions {
  limits: Record<PlanId, Record<UsageKind, number | null>>;
  /** Each plan's daily AI budget for chat and dictation, in US dollars (null: none). */
  budget: Record<PlanId, number | null>;
  /** About how many pictures (GPT Image) or clips a plan's monthly budget for them pays for (null: no cap). */
  media: Record<PlanId, { images: number; videos: number } | null>;
  /** The free plan draws with the free model (no credits, no photo edits). */
  freeImages: boolean;
  /** Credit packs on sale (empty without a payment method) and the least a request takes. */
  credits: { packs: CreditPack[]; min: Record<UsageKind, number> };
  /** Payment methods configured on this server: Stripe's price for each plan it sells; ЮKassa sells Pro. */
  methods: {
    yookassa: { price: string } | null;
    stripe: { prices: Partial<Record<PaidPlanId, string>> } | null;
  };
  /** Each paid plan's monthly price to show, also before a payment method is set up (null: not on sale). */
  prices: Record<PaidPlanId, string | null>;
}

/** Personal instructions for every chat (settings page). */
export interface InstructionsResponse {
  about: string;
  style: string;
}

/** What MARYX remembers about the user (settings page). */
export interface MemoryResponse {
  enabled: boolean;
  facts: { id: string; text: string; createdAt: number }[];
}

export interface PromoCode {
  code: string;
  days: number;
  credits: number;
  maxUses: number;
  uses: number;
  note?: string;
  createdAt: number;
}

/** Admin dashboard: what AI requests cost the server. */
export interface CostReport {
  /** Totals for today (UTC), the last 7 and the last 30 days, without requests paid by users' own keys. */
  totals: { period: "today" | "week" | "month"; usd: number; requests: number }[];
  /** Requests on users' own keys (BYOK) in the last 30 days — not paid by the server. */
  byok: { usd: number; requests: number };
  /** Daily budget for free requests across the whole site (AI_DAILY_BUDGET_USD), and today's free spending. */
  budget: { limit: number | null; spentToday: number };
  /** Share of the 30-day cost that was estimated from token counts rather than reported by the provider. */
  estimatedShare: number;
  /** The last 30 days (UTC), oldest first. */
  days: { day: string; usd: number }[];
  byModel: { provider: string; model: string; usd: number; requests: number }[];
  byUser: { userId: string | null; email: string | null; usd: number; requests: number; credits: number }[];
  byKind: { kind: CostKind; usd: number; requests: number }[];
  byPayer: { paidBy: PaidBy; usd: number; requests: number }[];
  /** Credits sold or given, and spent, in the last 30 days. */
  credits: { granted: number; spent: number };
}

// ---------- Scheduled tasks ----------

/**
 * How often a task runs, in the user's own time (its time zone): once at a
 * moment ("YYYY-MM-DDTHH:MM"), every day or week at "HH:MM" (weekday 0 =
 * Sunday), or every few hours (monitoring).
 */
export type TaskSchedule =
  | { kind: "once"; at: string }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; weekday: number }
  | { kind: "hourly"; every: number };

/** «Задачи»: a prompt MARYX runs on a schedule by itself; each answer goes to the task's chat. */
export interface Task {
  id: string;
  title: string;
  prompt: string;
  schedule: TaskSchedule;
  timezone: string;
  /** Searches the web on each run (news, prices, mentions). */
  search: boolean;
  active: boolean;
  nextRunAt?: number;
  lastRunAt?: number;
  lastStatus?: "ok" | "error" | "limit";
  lastError?: string;
  runs: number;
  /** A result not seen yet. */
  unread: boolean;
  chatId?: string;
  createdAt: number;
}

// ---------- Maps ----------

export type PlaceCategory =
  | "cafe"
  | "restaurant"
  | "fast_food"
  | "bar"
  | "pharmacy"
  | "atm"
  | "supermarket"
  | "fuel"
  | "hotel"
  | "museum"
  | "park"
  | "sight";

/** A place on the map, from OpenStreetMap. */
export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  /** What it is, in words ("Кафе · italian"). */
  kind: string;
  lat: number;
  lon: number;
  /** From the point asked about, in metres. */
  distance: number;
  address?: string;
  /** OpenStreetMap's opening hours, as written there ("Mo-Fr 08:00-20:00"). */
  hours?: string;
  website?: string;
  phone?: string;
}
