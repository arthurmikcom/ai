// What the app reads from the site's API (a subset of the site's src/lib/types.ts).

export type PlanId = "free" | "plus" | "pro" | "ultra";

export interface Me {
  user: { id: string; name: string; email: string; image?: string | null };
  admin: boolean;
  plan: { id: PlanId; until?: number | null };
  usage: Record<"chat" | "image" | "video" | "voice", { used: number; limit: number | null }>;
  credits: number;
  /** A guest chatting without an account. */
  guest?: boolean;
  photoEdits?: { perDay: number; left: number };
}

export interface Attachment {
  mime: string;
  url?: string;
  /** Base64, while it is being sent. */
  data?: string;
  name?: string;
  hidden?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  error?: string;
  errorCode?: string;
  notice?: string;
  suggestions?: string[];
  /** What the answer is busy with before its text (deep research steps and the like). */
  status?: string;
  /** The answer is being written right now. */
  streaming?: boolean;
  createdAt: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  temporary?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Chat extends ChatSummary {
  messages: ChatMessage[];
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "notice"; text: string }
  | { type: "source"; url: string; title?: string }
  | { type: "route"; retry?: boolean; image?: boolean; video?: boolean }
  | { type: "title"; title: string }
  | { type: "suggestions"; items: string[] }
  | { type: "image"; url: string; mime: string }
  | { type: "attached"; messageId: string; url: string; mime: string }
  | { type: "media"; item: { id: string } }
  | { type: "progress"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface MediaItem {
  id: string;
  kind: "image" | "video";
  prompt: string;
  status: "pending" | "succeeded" | "failed";
  error?: string;
  files: { url: string; mime: string }[];
  createdAt: number;
}

export const PLAN_NAMES: Record<PlanId, string> = { free: "Бесплатный", plus: "Plus", pro: "Pro", ultra: "Ultra" };
