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

export interface Attachment {
  mime: string;
  /** Base64 without the data: prefix. */
  data: string;
  name?: string;
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
  notice?: string;
  createdAt: number;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  provider: ProviderId;
  model: string;
  assistantId?: string;
  createdAt: number;
  updatedAt: number;
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

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  system?: string;
  deepThinking?: boolean;
  messages: Pick<ChatMessage, "role" | "content" | "attachments">[];
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
  blob: Blob;
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
  files: MediaFile[];
  createdAt: number;
}
