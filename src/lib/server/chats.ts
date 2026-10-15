import { and, asc, desc, eq } from "drizzle-orm";
import type { Assistant, Chat, ChatMessage, ChatSummary, ProviderId } from "@/lib/types";
import { getDb, schema } from "./db";
import { deleteFiles, fileUrl } from "./storage";

type ChatRow = typeof schema.chat.$inferSelect;
type MessageRow = typeof schema.message.$inferSelect;
type AssistantRow = typeof schema.assistant.$inferSelect;

function toSummary(row: ChatRow): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider,
    model: row.model,
    assistantId: row.assistantId ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning ?? undefined,
    attachments: row.attachments?.map((f) => ({ mime: f.mime, name: f.name, url: fileUrl(f.key) })),
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    error: row.error ?? undefined,
    notice: row.notice ?? undefined,
    sources: row.sources ?? undefined,
    via: row.via ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}

export function toAssistant(row: AssistantRow): Assistant {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    systemPrompt: row.systemPrompt,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}

export async function listChats(userId: string): Promise<ChatSummary[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.chat)
    .where(eq(schema.chat.userId, userId))
    .orderBy(desc(schema.chat.updatedAt))
    .limit(500);
  return rows.map(toSummary);
}

export async function findChat(userId: string, chatId: string): Promise<ChatRow | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.chat)
    .where(and(eq(schema.chat.id, chatId), eq(schema.chat.userId, userId)));
  return row;
}

export async function chatMessages(chatId: string): Promise<MessageRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.message)
    .where(eq(schema.message.chatId, chatId))
    .orderBy(asc(schema.message.seq));
}

export async function getChat(userId: string, chatId: string): Promise<Chat | null> {
  const row = await findChat(userId, chatId);
  if (!row) return null;
  const messages = await chatMessages(chatId);
  return { ...toSummary(row), messages: messages.map(toMessage) };
}

export async function updateChat(
  userId: string,
  chatId: string,
  changes: { title?: string; provider?: ProviderId; model?: string },
): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(schema.chat)
    .set(changes)
    .where(and(eq(schema.chat.id, chatId), eq(schema.chat.userId, userId)))
    .returning({ id: schema.chat.id });
  return rows.length > 0;
}

export async function deleteChat(userId: string, chatId: string): Promise<boolean> {
  const db = await getDb();
  const messages = await db
    .select({ attachments: schema.message.attachments })
    .from(schema.message)
    .innerJoin(schema.chat, eq(schema.chat.id, schema.message.chatId))
    .where(and(eq(schema.chat.id, chatId), eq(schema.chat.userId, userId)));
  const rows = await db
    .delete(schema.chat)
    .where(and(eq(schema.chat.id, chatId), eq(schema.chat.userId, userId)))
    .returning({ id: schema.chat.id });
  if (rows.length === 0) return false;
  await deleteFiles(messages.flatMap((m) => m.attachments ?? []).map((f) => f.key)).catch((e) =>
    console.error("[chats] failed to delete attachments", e),
  );
  return true;
}

// ---------- Assistants ----------

export async function listAssistants(userId: string): Promise<Assistant[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.assistant)
    .where(eq(schema.assistant.userId, userId))
    .orderBy(desc(schema.assistant.createdAt));
  return rows.map(toAssistant);
}

export async function findAssistant(userId: string, id: string): Promise<AssistantRow | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.assistant)
    .where(and(eq(schema.assistant.id, id), eq(schema.assistant.userId, userId)));
  return row;
}

/** Creates or updates an assistant. Returns false if the id belongs to someone else. */
export async function saveAssistant(userId: string, a: Assistant): Promise<boolean> {
  const db = await getDb();
  const values = {
    name: a.name,
    emoji: a.emoji,
    description: a.description,
    systemPrompt: a.systemPrompt,
    provider: a.provider ?? null,
    model: a.model ?? null,
  };
  const rows = await db
    .insert(schema.assistant)
    .values({ id: a.id, userId, createdAt: new Date(a.createdAt), ...values })
    .onConflictDoUpdate({
      target: schema.assistant.id,
      set: values,
      setWhere: eq(schema.assistant.userId, userId),
    })
    .returning({ id: schema.assistant.id });
  return rows.length > 0;
}

export async function deleteAssistant(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .delete(schema.assistant)
    .where(and(eq(schema.assistant.id, id), eq(schema.assistant.userId, userId)))
    .returning({ id: schema.assistant.id });
  return rows.length > 0;
}
