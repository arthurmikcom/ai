// Shared types used by both the browser and the server.

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "deepseek"
  | "xai"
  | "ollama"
  | "replicate";

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
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  configured: boolean;
  envVar: string;
  signupUrl: string;
  capabilities: Capability[];
  note: string;
}

export interface ModelsResponse {
  providers: ProviderStatus[];
  models: ModelInfo[];
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
}

/** What the server sends to the model provider: always inline bytes. */
export interface InlineImage {
  mime: string;
  data: string;
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
  createdAt: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  assistantId?: string;
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

/** Browser → /api/chat. The server loads the history itself. */
export interface ChatSendRequest {
  chatId: string;
  /** Set when this is the first message of a new chat. */
  create?: { assistantId?: string };
  provider: ProviderId;
  model: string;
  deepThinking?: boolean;
  /** The new user message; omitted when regenerating the last answer. */
  message?: { id: string; content: string; attachments?: InlineImage[] };
  /** Id for the assistant message the server will store. */
  answerId: string;
}

/** Server → model provider adapters. */
export interface ChatRequest {
  provider: ProviderId;
  model: string;
  system?: string;
  deepThinking?: boolean;
  messages: { role: "user" | "assistant"; content: string; attachments?: InlineImage[] }[];
}

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "notice"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

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
}

export type MediaOutput =
  | { type: "base64"; mime: string; data: string }
  | { type: "url"; url: string };

export type GenerateResult =
  | { status: "succeeded"; outputs: MediaOutput[] }
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
  createdAt: number;
}

// ---------- Account ----------

export type UsageKind = "chat" | "image" | "video";

/** Today's usage; `limit: null` means unlimited. */
export type UsageSummary = Record<UsageKind, { used: number; limit: number | null }>;

export type PlanId = "free" | "pro";

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
}

export interface MeResponse {
  user: { id: string; name: string; email: string; image?: string | null };
  admin: boolean;
  plan: PlanInfo;
  usage: UsageSummary;
  /** Social sign-in methods configured on this server. */
  social: { google: boolean; vk: boolean };
}

/** What /api/billing/plans tells the pricing page. */
export interface BillingOptions {
  limits: Record<PlanId, Record<UsageKind, number | null>>;
  /** Payment methods configured on this server, with the Pro price for each. */
  methods: {
    yookassa: { price: string } | null;
    stripe: { price: string } | null;
  };
}

export interface PromoCode {
  code: string;
  days: number;
  maxUses: number;
  uses: number;
  note?: string;
  createdAt: number;
}
