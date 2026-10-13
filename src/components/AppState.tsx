"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { assistantDB, chatDB } from "@/lib/client/db";
import { useStoredJson } from "@/lib/client/useStored";
import { readNdjson, uid } from "@/lib/client/util";
import type {
  Assistant,
  Attachment,
  Chat,
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  ProviderId,
} from "@/lib/types";

const DEFAULT_SYSTEM =
  "Ты — Nexus AI, умный и дружелюбный ассистент. Отвечай на языке пользователя. " +
  "Используй Markdown, когда это помогает: списки, таблицы, блоки кода с указанием языка.";

const MODEL_KEY = "nexus:model";

export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

interface AppState {
  ready: boolean;
  chats: Chat[];
  activeChat: Chat | null;
  openChat: (id: string | null) => void;
  deleteChat: (id: string) => void;
  setChatModel: (id: string, choice: ModelChoice) => void;

  /** Model used for the next new chat. */
  model: ModelChoice | null;
  setModel: (choice: ModelChoice) => void;
  /** Assistant chosen for the next new chat. */
  draftAssistantId: string | null;
  startChatWith: (assistantId: string | null) => void;

  /** Sends to the open chat, or starts a new one on `model`. */
  send: (text: string, attachments: Attachment[], deepThinking: boolean, model: ModelChoice | null) => void;
  regenerate: (chatId: string, deepThinking: boolean) => void;
  stop: (chatId: string) => void;
  isStreaming: (chatId: string) => boolean;

  assistants: Assistant[];
  saveAssistant: (a: Assistant) => void;
  deleteAssistant: (id: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside <AppStateProvider>");
  return ctx;
}

function titleFrom(text: string, attachments: Attachment[]): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return attachments.length ? "Изображение" : "Новый чат";
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  // The ref is the source of truth so async streaming code always sees the
  // latest chat; `chats` is the sorted snapshot that components render.
  const chatsRef = useRef(new Map<string, Chat>());
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useStoredJson<ModelChoice>(MODEL_KEY);
  const [draftAssistantId, setDraftAssistantId] = useState<string | null>(null);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const assistantsRef = useRef<Assistant[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const [streaming, setStreaming] = useState<ReadonlySet<string>>(new Set());

  const syncChats = useCallback(() => {
    setChats([...chatsRef.current.values()].sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  useEffect(() => {
    Promise.all([chatDB.all(), assistantDB.all()])
      .then(([saved, savedAssistants]) => {
        for (const c of saved) chatsRef.current.set(c.id, c);
        syncChats();
        const sorted = savedAssistants.sort((a, b) => b.createdAt - a.createdAt);
        assistantsRef.current = sorted;
        setAssistants(sorted);
      })
      .catch((e) => console.error("Не удалось загрузить данные", e))
      .finally(() => setReady(true));
  }, [syncChats]);

  const update = useCallback((id: string, fn: (c: Chat) => Chat, persist = false) => {
    const current = chatsRef.current.get(id);
    if (!current) return;
    const next = fn(current);
    chatsRef.current.set(id, next);
    syncChats();
    if (persist) chatDB.put(next).catch((e) => console.error(e));
  }, [syncChats]);

  const patchMessage = useCallback(
    (chatId: string, messageId: string, patch: Partial<ChatMessage>, persist = false) =>
      update(
        chatId,
        (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
        }),
        persist,
      ),
    [update],
  );

  const run = useCallback(
    async (chatId: string, deepThinking: boolean) => {
      const chat = chatsRef.current.get(chatId);
      if (!chat || controllers.current.has(chatId)) return;

      const assistant = assistantsRef.current.find((a) => a.id === chat.assistantId);
      const history: ChatRequest["messages"] = chat.messages
        .filter((m) => m.role === "user" || (m.content && !m.error))
        .map(({ role, content, attachments }) => ({ role, content, attachments }));

      const answerId = uid();
      update(chatId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: [
          ...c.messages,
          {
            id: answerId,
            role: "assistant",
            content: "",
            provider: c.provider,
            model: c.model,
            createdAt: Date.now(),
          },
        ],
      }));

      const controller = new AbortController();
      controllers.current.set(chatId, controller);
      setStreaming((s) => new Set(s).add(chatId));

      let text = "";
      let reasoning = "";
      let notice = "";
      let lastFlush = 0;
      const flush = (force = false) => {
        const now = performance.now();
        if (!force && now - lastFlush < 50) return;
        lastFlush = now;
        patchMessage(chatId, answerId, {
          content: text,
          reasoning: reasoning || undefined,
          notice: notice || undefined,
        });
      };

      try {
        const body: ChatRequest = {
          provider: chat.provider,
          model: chat.model,
          system: assistant?.systemPrompt || DEFAULT_SYSTEM,
          deepThinking,
          messages: history,
        };
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error ?? `Ошибка сервера (${res.status})`);
        }
        for await (const event of readNdjson<ChatStreamEvent>(res)) {
          if (event.type === "text") text += event.text;
          else if (event.type === "reasoning") reasoning += event.text;
          else if (event.type === "notice") notice = notice ? `${notice}\n${event.text}` : event.text;
          else if (event.type === "error") throw new Error(event.message);
          flush();
        }
        flush(true);
      } catch (err) {
        flush(true);
        if (controller.signal.aborted) {
          patchMessage(chatId, answerId, { notice: "Генерация остановлена." });
        } else {
          patchMessage(chatId, answerId, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        controllers.current.delete(chatId);
        setStreaming((s) => {
          const next = new Set(s);
          next.delete(chatId);
          return next;
        });
        update(chatId, (c) => ({ ...c, updatedAt: Date.now() }), true);
      }
    },
    [patchMessage, update],
  );

  const send = useCallback(
    (text: string, attachments: Attachment[], deepThinking: boolean, model: ModelChoice | null) => {
      let chatId = activeId;
      const message: ChatMessage = {
        id: uid(),
        role: "user",
        content: text,
        attachments: attachments.length ? attachments : undefined,
        createdAt: Date.now(),
      };

      if (chatId && chatsRef.current.has(chatId)) {
        update(chatId, (c) => ({ ...c, messages: [...c.messages, message] }), true);
      } else {
        if (!model) return;
        const assistant = assistantsRef.current.find((a) => a.id === draftAssistantId);
        const chat: Chat = {
          id: uid(),
          title: titleFrom(text, attachments),
          messages: [message],
          provider: model.provider,
          model: model.model,
          assistantId: assistant?.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        chatId = chat.id;
        chatsRef.current.set(chat.id, chat);
        chatDB.put(chat).catch((e) => console.error(e));
        syncChats();
        setActiveId(chat.id);
      }
      void run(chatId, deepThinking);
    },
    [activeId, draftAssistantId, run, syncChats, update],
  );

  const regenerate = useCallback(
    (chatId: string, deepThinking: boolean) => {
      const chat = chatsRef.current.get(chatId);
      if (!chat || controllers.current.has(chatId)) return;
      const last = chat.messages[chat.messages.length - 1];
      if (last?.role === "assistant") {
        update(chatId, (c) => ({ ...c, messages: c.messages.slice(0, -1) }));
      }
      void run(chatId, deepThinking);
    },
    [run, update],
  );

  const stop = useCallback((chatId: string) => controllers.current.get(chatId)?.abort(), []);

  const deleteChat = useCallback(
    (id: string) => {
      controllers.current.get(id)?.abort();
      chatsRef.current.delete(id);
      chatDB.remove(id).catch((e) => console.error(e));
      syncChats();
      setActiveId((current) => (current === id ? null : current));
    },
    [syncChats],
  );

  const setChatModel = useCallback(
    (id: string, choice: ModelChoice) => {
      update(id, (c) => ({ ...c, ...choice }), true);
      setModel(choice);
    },
    [setModel, update],
  );

  const openChat = useCallback((id: string | null) => {
    setActiveId(id);
    if (id === null) setDraftAssistantId(null);
  }, []);

  const startChatWith = useCallback(
    (assistantId: string | null) => {
      setActiveId(null);
      setDraftAssistantId(assistantId);
      // An assistant can pin its own model; it becomes the picker's selection.
      const assistant = assistantsRef.current.find((a) => a.id === assistantId);
      if (assistant?.provider && assistant.model) {
        setModel({ provider: assistant.provider, model: assistant.model });
      }
    },
    [setModel],
  );

  const saveAssistant = useCallback((a: Assistant) => {
    const next = [a, ...assistantsRef.current.filter((x) => x.id !== a.id)].sort(
      (x, y) => y.createdAt - x.createdAt,
    );
    assistantsRef.current = next;
    setAssistants(next);
    assistantDB.put(a).catch((e) => console.error(e));
  }, []);

  const deleteAssistant = useCallback((id: string) => {
    const next = assistantsRef.current.filter((x) => x.id !== id);
    assistantsRef.current = next;
    setAssistants(next);
    assistantDB.remove(id).catch((e) => console.error(e));
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ready,
      chats,
      activeChat: (activeId && chats.find((c) => c.id === activeId)) || null,
      openChat,
      deleteChat,
      setChatModel,
      model,
      setModel,
      draftAssistantId,
      startChatWith,
      send,
      regenerate,
      stop,
      isStreaming: (id) => streaming.has(id),
      assistants,
      saveAssistant,
      deleteAssistant,
    }),
    [
      ready,
      chats,
      activeId,
      openChat,
      deleteChat,
      setChatModel,
      model,
      setModel,
      draftAssistantId,
      startChatWith,
      send,
      regenerate,
      stop,
      streaming,
      assistants,
      saveAssistant,
      deleteAssistant,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
