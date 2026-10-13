"use client";

import { usePathname } from "next/navigation";
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
import { api, errorOf } from "@/lib/client/api";
import { authClient } from "@/lib/client/auth";
import { useStoredJson } from "@/lib/client/useStored";
import { readNdjson, uid } from "@/lib/client/util";
import type {
  Assistant,
  Attachment,
  Chat,
  ChatMessage,
  ChatSendRequest,
  ChatStreamEvent,
  ChatSummary,
  MeResponse,
  ProviderId,
} from "@/lib/types";

const MODEL_KEY = "nexus:model";

export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

/** A chat in memory; messages arrive when it's first opened. */
export interface LocalChat extends Chat {
  loaded: boolean;
}

interface AppState {
  ready: boolean;
  me: MeResponse | null;
  refreshMe: () => void;
  signOut: () => Promise<void>;

  chats: LocalChat[];
  activeChat: LocalChat | null;
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
  saveAssistant: (a: Assistant) => Promise<void>;
  deleteAssistant: (id: string) => Promise<void>;
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
  const pathname = usePathname();
  const onLoginPage = pathname === "/login";
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  // The ref is the source of truth so async streaming code always sees the
  // latest chat; `chats` is the sorted snapshot that components render.
  const chatsRef = useRef(new Map<string, LocalChat>());
  const [chats, setChats] = useState<LocalChat[]>([]);
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

  const refreshMe = useCallback(() => {
    api<MeResponse>("/api/me").then(setMe, (e) => console.error(e));
  }, []);

  useEffect(() => {
    if (onLoginPage) return;
    Promise.all([
      api<MeResponse>("/api/me"),
      api<ChatSummary[]>("/api/chats"),
      api<Assistant[]>("/api/assistants"),
    ])
      .then(([profile, list, saved]) => {
        setMe(profile);
        for (const c of list) {
          if (!chatsRef.current.has(c.id)) chatsRef.current.set(c.id, { ...c, messages: [], loaded: false });
        }
        syncChats();
        assistantsRef.current = saved;
        setAssistants(saved);
      })
      .catch((e) => console.error("Не удалось загрузить данные", e))
      .finally(() => setReady(true));
  }, [onLoginPage, syncChats]);

  const update = useCallback(
    (id: string, fn: (c: LocalChat) => LocalChat) => {
      const current = chatsRef.current.get(id);
      if (!current) return;
      chatsRef.current.set(id, fn(current));
      syncChats();
    },
    [syncChats],
  );

  const patchMessage = useCallback(
    (chatId: string, messageId: string, patch: Partial<ChatMessage>) =>
      update(chatId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      })),
    [update],
  );

  const run = useCallback(
    async (
      chatId: string,
      options: { deepThinking: boolean; message?: ChatMessage; create?: { assistantId?: string } },
    ) => {
      const chat = chatsRef.current.get(chatId);
      if (!chat || controllers.current.has(chatId)) return;

      const answerId = uid();
      update(chatId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: [
          ...c.messages,
          { id: answerId, role: "assistant", content: "", provider: c.provider, model: c.model, createdAt: Date.now() },
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
        const { message } = options;
        const body: ChatSendRequest = {
          chatId,
          create: options.create,
          provider: chat.provider,
          model: chat.model,
          deepThinking: options.deepThinking,
          message: message && {
            id: message.id,
            content: message.content,
            attachments: message.attachments?.flatMap((a) => (a.data ? [{ mime: a.mime, data: a.data }] : [])),
          },
          answerId,
        };
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) throw await errorOf(res);
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
          patchMessage(chatId, answerId, { error: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        controllers.current.delete(chatId);
        setStreaming((s) => {
          const next = new Set(s);
          next.delete(chatId);
          return next;
        });
        update(chatId, (c) => ({ ...c, updatedAt: Date.now() }));
        refreshMe();
      }
    },
    [patchMessage, refreshMe, update],
  );

  const send = useCallback(
    (text: string, attachments: Attachment[], deepThinking: boolean, choice: ModelChoice | null) => {
      const message: ChatMessage = {
        id: uid(),
        role: "user",
        content: text,
        attachments: attachments.length ? attachments : undefined,
        createdAt: Date.now(),
      };

      const existing = activeId ? chatsRef.current.get(activeId) : undefined;
      if (existing) {
        update(existing.id, (c) => ({ ...c, messages: [...c.messages, message] }));
        void run(existing.id, { deepThinking, message });
        return;
      }

      if (!choice) return;
      const assistantId = assistantsRef.current.find((a) => a.id === draftAssistantId)?.id;
      const chat: LocalChat = {
        id: uid(),
        title: titleFrom(text, attachments),
        messages: [message],
        provider: choice.provider,
        model: choice.model,
        assistantId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        loaded: true,
      };
      chatsRef.current.set(chat.id, chat);
      syncChats();
      setActiveId(chat.id);
      void run(chat.id, { deepThinking, message, create: { assistantId } });
    },
    [activeId, draftAssistantId, run, syncChats, update],
  );

  const regenerate = useCallback(
    (chatId: string, deepThinking: boolean) => {
      const chat = chatsRef.current.get(chatId);
      if (!chat || controllers.current.has(chatId)) return;
      if (chat.messages[chat.messages.length - 1]?.role === "assistant") {
        update(chatId, (c) => ({ ...c, messages: c.messages.slice(0, -1) }));
      }
      void run(chatId, { deepThinking });
    },
    [run, update],
  );

  const stop = useCallback((chatId: string) => controllers.current.get(chatId)?.abort(), []);

  const openChat = useCallback(
    (id: string | null) => {
      setActiveId(id);
      if (id === null) {
        setDraftAssistantId(null);
        return;
      }
      const chat = chatsRef.current.get(id);
      if (chat && !chat.loaded) {
        api<Chat>(`/api/chats/${id}`).then(
          (full) => update(id, (c) => ({ ...c, ...full, loaded: true })),
          (e) => console.error(e),
        );
      }
    },
    [update],
  );

  const deleteChat = useCallback(
    (id: string) => {
      controllers.current.get(id)?.abort();
      chatsRef.current.delete(id);
      syncChats();
      setActiveId((current) => (current === id ? null : current));
      api(`/api/chats/${id}`, { method: "DELETE" }).catch((e) => console.error(e));
    },
    [syncChats],
  );

  const setChatModel = useCallback(
    (id: string, choice: ModelChoice) => {
      update(id, (c) => ({ ...c, ...choice }));
      setModel(choice);
      api(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify(choice) }).catch((e) =>
        console.error(e),
      );
    },
    [setModel, update],
  );

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

  const saveAssistant = useCallback(async (a: Assistant) => {
    const saved = await api<Assistant>("/api/assistants", { method: "POST", body: JSON.stringify(a) });
    const next = [saved, ...assistantsRef.current.filter((x) => x.id !== saved.id)].sort(
      (x, y) => y.createdAt - x.createdAt,
    );
    assistantsRef.current = next;
    setAssistants(next);
  }, []);

  const deleteAssistant = useCallback(async (id: string) => {
    await api(`/api/assistants/${id}`, { method: "DELETE" });
    const next = assistantsRef.current.filter((x) => x.id !== id);
    assistantsRef.current = next;
    setAssistants(next);
  }, []);

  const signOut = useCallback(async () => {
    controllers.current.forEach((c) => c.abort());
    await authClient.signOut();
    // A full reload, so nothing of this account stays in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ready,
      me,
      refreshMe,
      signOut,
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
      me,
      refreshMe,
      signOut,
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
