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
import { api, ApiError, errorOf } from "@/lib/client/api";
import { authClient } from "@/lib/client/auth";
import { sessionSettled } from "@/lib/client/session";
import { track } from "@/lib/client/media";
import { useStoredJson } from "@/lib/client/useStored";
import { buildMessages, generateLocal, localSupport, localSystemPrompt, personalInstructions } from "@/lib/client/local-ai";
import { readNdjson, uid } from "@/lib/client/util";
import type {
  Assistant,
  Attachment,
  Chat,
  ChatMessage,
  ChatSendRequest,
  ChatStreamEvent,
  ChatSummary,
  InlineFile,
  MeResponse,
  ProviderId,
  SendOptions,
  Source,
} from "@/lib/types";

const MODEL_KEY = "maryx:model";

export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

/** A chat in memory; messages arrive when it's first opened. */
export interface LocalChat extends Chat {
  loaded: boolean;
  /** The server has this chat (false for a new one until its first message is accepted). */
  saved: boolean;
}

interface AppState {
  ready: boolean;
  me: MeResponse | null;
  /** Only MARYX is offered (true until the server says otherwise, so other models never flash). */
  maryxOnly: boolean;
  refreshMe: () => void;
  signOut: () => Promise<void>;

  chats: LocalChat[];
  activeChat: LocalChat | null;
  openChat: (id: string | null) => void;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  setChatModel: (id: string, choice: ModelChoice) => void;

  /** Model used for the next new chat. */
  model: ModelChoice | null;
  setModel: (choice: ModelChoice) => void;
  /** Assistant chosen for the next new chat. */
  draftAssistantId: string | null;
  startChatWith: (assistantId: string | null) => void;
  /** «Временный чат»: the next new chat isn't kept (not in the history or MARYX's memory). */
  draftTemporary: boolean;
  /** Starts a new chat, temporary or not (leaving a temporary chat deletes it). */
  setTemporary: (on: boolean) => void;
  /** Fetches the chat list again (new chats and messages made elsewhere: a scheduled task's run). */
  reloadChats: () => void;

  /** Sends to the open chat, or starts a new one on `model`. */
  send: (text: string, attachments: Attachment[], options: SendOptions, model: ModelChoice | null) => void;
  regenerate: (chatId: string, options: SendOptions) => void;
  /** Sends a corrected version of the chat's last question; it (and its answer) are replaced. */
  editLast: (chatId: string, text: string, options: SendOptions) => void;
  stop: (chatId: string) => void;
  isStreaming: (chatId: string) => boolean;
  /** 👍 (1), 👎 (-1, with what was wrong) or taking it back (0) on an answer. */
  rate: (chatId: string, messageId: string, rating: -1 | 0 | 1, reason?: string) => void;

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

/** Crawlers see the pages without becoming guests (each would be a new user). */
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|lighthouse/i;

/** An answer from the API, or its error (a missing session goes to the login page). */
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as T;
}

/**
 * The profile. A visitor without a session becomes a guest first (like
 * ChatGPT's: chatting needs no account; the other sections ask to sign in).
 */
async function loadProfile(): Promise<{ me: MeResponse; fresh: boolean }> {
  const res = await fetch("/api/me");
  if (res.status === 401 && !BOT.test(navigator.userAgent)) {
    const { error } = await authClient.signIn.anonymous();
    if (!error) return { me: await json<MeResponse>(await fetch("/api/me")), fresh: true };
  }
  return { me: await json<MeResponse>(res), fresh: false };
}

function titleFrom(text: string, attachments: Attachment[]): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return attachments.find((a) => !a.mime.startsWith("image/"))?.name ?? (attachments.length ? "Изображение" : "Новый чат");
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Pages seen without signing in: nothing to load for them.
  const onLoginPage = ["/login", "/reset-password", "/terms", "/refund", "/privacy"].includes(pathname);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  // The ref is the source of truth so async streaming code always sees the
  // latest chat; `chats` is the sorted snapshot that components render.
  const chatsRef = useRef(new Map<string, LocalChat>());
  const [chats, setChats] = useState<LocalChat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [model, setModel] = useStoredJson<ModelChoice>(MODEL_KEY);
  const maryxOnly = me?.maryxOnly ?? true;
  // Read by the streaming code, which outlives renders.
  const maryxOnlyRef = useRef(maryxOnly);
  useEffect(() => {
    maryxOnlyRef.current = maryxOnly;
  }, [maryxOnly]);
  const [draftAssistantId, setDraftAssistantId] = useState<string | null>(null);
  const [draftTemporary, setDraftTemporary] = useState(false);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const assistantsRef = useRef<Assistant[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  // Answers being written in this browser, to save if the tab is closed meanwhile.
  const pendingLocal = useRef(new Map<string, () => Record<string, unknown>>());

  useEffect(() => {
    const onHide = () => {
      for (const body of pendingLocal.current.values()) {
        navigator.sendBeacon("/api/chat/local", new Blob([JSON.stringify(body())], { type: "application/json" }));
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
  const [streaming, setStreaming] = useState<ReadonlySet<string>>(new Set());

  const syncChats = useCallback(() => {
    setChats([...chatsRef.current.values()].sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  const refreshMe = useCallback(() => {
    api<MeResponse>("/api/me").then(setMe, (e) => console.error(e));
  }, []);

  useEffect(() => {
    // Nothing to wait for on the pages seen signed out.
    if (onLoginPage) return sessionSettled();
    // The profile also says which mode the site is in: loaded on its own, so it arrives even if the rest fails.
    const profile = loadProfile()
      .then((p) => {
        setMe(p.me);
        return p;
      })
      .finally(sessionSettled);
    // The lists load alongside; a guest's session only now begun gets them again with it.
    const early = Promise.all([fetch("/api/chats"), fetch("/api/assistants")]).catch(() => null);
    Promise.all([profile, early])
      .then(([{ fresh }, res]) =>
        fresh || !res
          ? Promise.all([api<ChatSummary[]>("/api/chats"), api<Assistant[]>("/api/assistants")])
          : Promise.all([json<ChatSummary[]>(res[0]), json<Assistant[]>(res[1])]),
      )
      .then(([list, saved]) => {
        for (const c of list) {
          if (!chatsRef.current.has(c.id)) chatsRef.current.set(c.id, { ...c, messages: [], loaded: false, saved: true });
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
      // `replace`: the id of the last question, which `message` corrects (it and its answer go).
      options: SendOptions & { message?: ChatMessage; replace?: string },
    ) => {
      const chat = chatsRef.current.get(chatId);
      if (!chat || controllers.current.has(chatId)) return;

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
            generating: options.image ? "image" : options.webSearch ? "search" : undefined,
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
      const images: Attachment[] = [];
      const sources: Source[] = [];
      // A picture is credited to the image model that drew it, not the chat model.
      let drawnBy: Pick<ChatMessage, "provider" | "model"> = {};
      // "done" ends the answer; the stream may still bring a chat title and follow-ups.
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        controllers.current.delete(chatId);
        setStreaming((s) => {
          const next = new Set(s);
          next.delete(chatId);
          return next;
        });
        update(chatId, (c) => ({ ...c, updatedAt: Date.now() }));
        refreshMe();
      };
      let lastFlush = 0;
      const flush = (force = false) => {
        const now = performance.now();
        if (!force && now - lastFlush < 50) return;
        lastFlush = now;
        patchMessage(chatId, answerId, {
          content: text,
          reasoning: reasoning || undefined,
          notice: notice || undefined,
          attachments: images.length ? [...images] : undefined,
          sources: sources.length ? [...sources] : undefined,
          ...drawnBy,
        });
      };

      try {
        const { message } = options;
        if (options.local) {
          // ----- A model in this browser: the server only stores the turn. -----
          const local = options.local;
          const maryx = chat.provider === "maryx";
          const questionId = message?.id ?? chat.messages.findLast((m) => m.role === "user")?.id;
          const post = (payload: Record<string, unknown>) =>
            fetch("/api/chat/local", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId, provider: chat.provider, model: chat.model, ...payload }),
            });
          // Nothing is stored for a browser that can't run the model.
          const support = await localSupport();
          if (!support.ok) {
            if (message) patchMessage(chatId, message.id, { unsent: true });
            throw new Error(support.reason);
          }
          // 1. The question, or (regenerate) a check that it is still the last one. Stop
          // doesn't cancel this request: the server may already have stored the question.
          const first = await post(
            message
              ? { create: chat.saved ? undefined : { assistantId: chat.assistantId, temporary: chat.temporary }, message: { id: message.id, content: message.content } }
              : { replyTo: questionId },
          );
          if (!first.ok) {
            if (message) patchMessage(chatId, message.id, { unsent: true });
            throw await errorOf(first);
          }
          if (message) {
            update(chatId, (c) => ({
              ...c,
              saved: true,
              messages: c.messages.map((m) => (m.id === message.id ? { ...m, unsent: undefined } : m)),
            }));
          }
          // The answer is credited to the browser model — or, in MARYX-only mode, to MARYX.
          drawnBy = maryxOnlyRef.current ? { provider: "maryx", model: "maryx" } : { provider: "browser", model: local.model };
          patchMessage(chatId, answerId, { ...drawnBy, via: maryx ? "maryx" : undefined });

          let error: string | undefined;
          const answer = (extra?: string) => ({
            answer: {
              id: answerId,
              // The same limits as the server's.
              content: text.slice(0, 30_000),
              reasoning: reasoning.slice(0, 30_000),
              notice: [notice, extra].filter(Boolean).join("\n").slice(0, 1000),
              error: error?.slice(0, 1000),
              model: local.model,
              replyTo: questionId,
              // A regenerated answer replaces the previous one only once it exists.
              replace: !message,
            },
          });
          // Closing the tab mid-answer still keeps what was written so far.
          pendingLocal.current.set(chatId, () => ({
            chatId,
            provider: chat.provider,
            model: chat.model,
            ...answer("Ответ прерван: вкладка была закрыта."),
          }));

          // 2. The answer, written on this device.
          try {
            if (controller.signal.aborted) throw new DOMException("Остановлено", "AbortError");
            const { about, style } = await personalInstructions();
            const assistant = assistantsRef.current.find((a) => a.id === chat.assistantId);
            const history = (chatsRef.current.get(chatId)?.messages ?? [])
              .filter((m) => m.id !== answerId && !m.error && (m.role === "user" || m.content))
              .map((m) => ({
                role: m.role,
                content:
                  m.role === "user"
                    ? m.attachments?.length
                      ? `${m.content}\n[К сообщению были приложены файлы — модель в браузере их не видит]`
                      : m.content
                    : m.attachments?.length
                      ? "[Здесь была картинка, нарисованная другой моделью. Модель в браузере рисовать не умеет.]"
                      : m.content,
              }));
            const built = buildMessages(
              localSystemPrompt({ model: local.model, maryx, assistantPrompt: assistant?.systemPrompt, about, style, brand: maryxOnlyRef.current }),
              history,
              options.deepThinking,
            );
            if (built.cut) notice = "Сообщение длинное — модель в браузере видит только его начало и конец.";
            for await (const part of generateLocal({
              model: local.model,
              messages: built.messages,
              deep: options.deepThinking,
              signal: controller.signal,
              onStatus: (status) => patchMessage(chatId, answerId, { status }),
              brand: maryxOnlyRef.current,
            })) {
              text = part.text;
              reasoning = part.reasoning;
              if (part.truncated) {
                notice = text
                  ? "Ответ обрезан: модель в браузере пишет за раз не так много. Попросите продолжить."
                  : "Модель не успела додумать до ответа. Выключите «Думать глубже» или упростите вопрос.";
              }
              flush();
            }
          } catch (err) {
            if (controller.signal.aborted) notice = notice ? `${notice}\nГенерация остановлена.` : "Генерация остановлена.";
            else error = err instanceof Error ? err.message : String(err);
          }
          patchMessage(chatId, answerId, { status: undefined, error });
          flush(true);

          // 3. Saved like server answers, also when stopped or failed; one retry.
          pendingLocal.current.delete(chatId);
          let stored = false;
          for (let attempt = 0; attempt < 2 && !stored; attempt++) {
            const res = await post(answer()).catch(() => null);
            if (res?.ok) stored = true;
            else if (res && res.status !== 429 && res.status < 500) break;
            else await new Promise((r) => setTimeout(r, 1000));
          }
          if (!stored) {
            notice = [notice, "Ответ не сохранился на сервере — скопируйте его: после обновления страницы он пропадёт."]
              .filter(Boolean)
              .join("\n");
            flush(true);
          }
          return;
        }
        const body: ChatSendRequest = {
          chatId,
          // A chat the server doesn't have yet is created with its (first accepted) message.
          create: message && !chat.saved ? { assistantId: chat.assistantId, temporary: chat.temporary } : undefined,
          // Regenerate names the message it answers, so a refused one isn't mixed up.
          replyTo: message ? undefined : chat.messages.findLast((m) => m.role === "user")?.id,
          provider: chat.provider,
          model: chat.model,
          deepThinking: options.deepThinking,
          image: options.image,
          video: options.video,
          camera: options.video ? options.camera : undefined,
          style: options.image ? options.style : undefined,
          webSearch: options.webSearch,
          research: options.research,
          council: options.council,
          better: options.better,
          message: message && {
            id: message.id,
            content: message.content,
            // A corrected question keeps the stored files of the one it replaces (the server moves them).
            attachments: options.replace
              ? undefined
              : message.attachments?.flatMap((a): InlineFile[] =>
                  // A whole video goes by its storage key (uploaded beforehand); the rest as data.
                  a.key
                    ? [{ mime: a.mime, data: "", name: a.name, key: a.key }]
                    : a.data
                      ? [{ mime: a.mime, data: a.data, name: a.name, ...(a.hidden ? { hidden: true } : {}) }]
                      : [],
                ),
          },
          replace: options.replace,
          answerId,
        };
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          // Refused before anything was saved: remember that, so "regenerate" re-sends it.
          if (message) patchMessage(chatId, message.id, { unsent: true });
          throw await errorOf(res);
        }
        if (message) {
          update(chatId, (c) => ({
            ...c,
            saved: true,
            messages: c.messages.map((m) => (m.id === message.id ? { ...m, unsent: undefined } : m)),
          }));
        }
        for await (const event of readNdjson<ChatStreamEvent>(res)) {
          if (event.type === "title") {
            update(chatId, (c) => ({ ...c, title: event.title }));
            continue;
          }
          if (event.type === "suggestions") {
            patchMessage(chatId, answerId, { suggestions: event.items });
            continue;
          }
          if (event.type === "progress") {
            // A step of the work before the answer: the steps so far show as a list.
            update(chatId, (c) => ({
              ...c,
              messages: c.messages.map((m) => (m.id === answerId ? { ...m, status: m.status ? `${m.status}\n${event.text}` : event.text } : m)),
            }));
            continue;
          }
          if (event.type === "attached") {
            patchMessage(chatId, event.messageId, { attachments: [{ url: event.url, mime: event.mime }] });
            continue;
          }
          if (finished) continue;
          if (event.type === "done") {
            flush(true);
            finish();
            continue;
          }
          if (event.type === "text") text += event.text;
          else if (event.type === "reasoning") reasoning += event.text;
          else if (event.type === "notice") notice = notice ? `${notice}\n${event.text}` : event.text;
          else if (event.type === "source") sources.push({ url: event.url, title: event.title });
          else if (event.type === "route") {
            // MARYX picked the real model (and maybe search or drawing) for this answer.
            // On "retry" the previous model failed before answering: start over.
            if (event.retry) {
              text = "";
              reasoning = "";
              notice = "";
              sources.length = 0;
              images.length = 0;
              flush(true);
            }
            drawnBy = { provider: event.provider, model: event.model };
            patchMessage(chatId, answerId, {
              via: "maryx",
              ...drawnBy,
              generating: event.image ? "image" : event.video ? "video" : event.search ? "search" : undefined,
            });
          }
          else if (event.type === "image") {
            images.push({ url: event.url, mime: event.mime });
            drawnBy = { provider: event.provider, model: event.model };
          }
          else if (event.type === "media") {
            // A video answer: the gallery item is followed until the clip is ready (here and in the studio).
            track(event.item);
            patchMessage(chatId, answerId, { mediaId: event.item.id });
          }
          else if (event.type === "error") {
            // The answer failed, but a chat title may still follow.
            flush(true);
            patchMessage(chatId, answerId, { error: event.message });
            finish();
            continue;
          }
          flush();
        }
        flush(true);
      } catch (err) {
        // Only the extras after "done" were lost; the answer itself is complete.
        if (finished) return;
        flush(true);
        if (controller.signal.aborted) {
          patchMessage(chatId, answerId, { notice: "Генерация остановлена." });
        } else {
          patchMessage(chatId, answerId, {
            error: err instanceof Error ? err.message : String(err),
            errorCode: err instanceof ApiError ? err.code : undefined,
          });
        }
      } finally {
        finish();
      }
    },
    [patchMessage, refreshMe, update],
  );

  const send = useCallback(
    (text: string, attachments: Attachment[], options: SendOptions, choice: ModelChoice | null) => {
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
        void run(existing.id, { ...options, message });
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
        ...(draftTemporary ? { temporary: true } : {}),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        loaded: true,
        saved: false,
      };
      chatsRef.current.set(chat.id, chat);
      syncChats();
      setActiveId(chat.id);
      void run(chat.id, { ...options, message });
    },
    [activeId, draftAssistantId, draftTemporary, run, syncChats, update],
  );

  const regenerate = useCallback(
    (chatId: string, options: SendOptions) => {
      const chat = chatsRef.current.get(chatId);
      if (!chat || controllers.current.has(chatId)) return;
      if (chat.messages[chat.messages.length - 1]?.role === "assistant") {
        update(chatId, (c) => ({ ...c, messages: c.messages.slice(0, -1) }));
      }
      // The question itself never reached the server: send it again instead.
      const lastUser = chat.messages.findLast((m) => m.role === "user");
      void run(chatId, lastUser?.unsent ? { ...options, message: lastUser } : options);
    },
    [run, update],
  );

  const editLast = useCallback(
    (chatId: string, text: string, options: SendOptions) => {
      const chat = chatsRef.current.get(chatId);
      if (!chat || controllers.current.has(chatId)) return;
      const i = chat.messages.findLastIndex((m) => m.role === "user");
      if (i < 0) return;
      const old = chat.messages[i];
      const message: ChatMessage = { ...old, id: uid(), content: text, unsent: undefined, createdAt: Date.now() };
      update(chatId, (c) => ({ ...c, messages: [...c.messages.slice(0, i), message] }));
      // A question the server never got is simply sent (with its files) instead.
      void run(chatId, { ...options, message, replace: old.unsent ? undefined : old.id });
    },
    [run, update],
  );

  const stop = useCallback((chatId: string) => controllers.current.get(chatId)?.abort(), []);

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

  /** Leaving a temporary chat deletes it: it's kept nowhere. */
  const leave = useCallback(
    (next: string | null) => {
      if (activeId && activeId !== next && chatsRef.current.get(activeId)?.temporary) deleteChat(activeId);
    },
    [activeId, deleteChat],
  );

  const openChat = useCallback(
    (id: string | null) => {
      leave(id);
      setActiveId(id);
      if (id === null) {
        setDraftAssistantId(null);
        setDraftTemporary(false);
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
    [leave, update],
  );

  const renameChat = useCallback(
    (id: string, title: string) => {
      update(id, (c) => ({ ...c, title }));
      api(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }).catch((e) => console.error(e));
    },
    [update],
  );

  const rate = useCallback(
    (chatId: string, messageId: string, rating: -1 | 0 | 1, reason?: string) => {
      patchMessage(chatId, messageId, { rating: rating || undefined, ratingReason: rating === -1 ? reason : undefined });
      api(`/api/chats/${chatId}/rating`, { method: "PUT", body: JSON.stringify({ messageId, rating, ...(reason ? { reason } : {}) }) }).catch((e) =>
        console.error(e),
      );
    },
    [patchMessage],
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
      leave(null);
      setActiveId(null);
      setDraftAssistantId(assistantId);
      setDraftTemporary(false);
      // An assistant can pin its own model; it becomes the picker's selection.
      const assistant = assistantsRef.current.find((a) => a.id === assistantId);
      if (assistant?.provider && assistant.model) {
        setModel({ provider: assistant.provider, model: assistant.model });
      }
    },
    [leave, setModel],
  );

  const reloadChats = useCallback(() => {
    api<ChatSummary[]>("/api/chats").then(
      (list) => {
        for (const c of list) {
          const known = chatsRef.current.get(c.id);
          if (!known) {
            chatsRef.current.set(c.id, { ...c, messages: [], loaded: false, saved: true });
          } else if (known.updatedAt !== c.updatedAt && !controllers.current.has(c.id)) {
            // New messages came: the open chat reads them now, others when opened.
            chatsRef.current.set(c.id, { ...known, ...c, loaded: c.id === activeId ? known.loaded : false });
            if (c.id === activeId) {
              api<Chat>(`/api/chats/${c.id}`).then(
                (full) => update(c.id, (x) => ({ ...x, ...full, loaded: true })),
                (e) => console.error(e),
              );
            }
          }
        }
        syncChats();
      },
      (e) => console.error(e),
    );
  }, [activeId, syncChats, update]);

  const setTemporary = useCallback(
    (on: boolean) => {
      leave(null);
      setActiveId(null);
      setDraftAssistantId(null);
      setDraftTemporary(on);
    },
    [leave],
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
      maryxOnly,
      refreshMe,
      signOut,
      chats,
      activeChat: (activeId && chats.find((c) => c.id === activeId)) || null,
      openChat,
      deleteChat,
      renameChat,
      setChatModel,
      model,
      setModel,
      draftAssistantId,
      startChatWith,
      draftTemporary,
      setTemporary,
      reloadChats,
      send,
      regenerate,
      editLast,
      stop,
      isStreaming: (id) => streaming.has(id),
      rate,
      assistants,
      saveAssistant,
      deleteAssistant,
    }),
    [
      ready,
      me,
      maryxOnly,
      refreshMe,
      signOut,
      chats,
      activeId,
      openChat,
      deleteChat,
      renameChat,
      setChatModel,
      model,
      setModel,
      draftAssistantId,
      startChatWith,
      draftTemporary,
      setTemporary,
      reloadChats,
      send,
      regenerate,
      editLast,
      stop,
      streaming,
      rate,
      assistants,
      saveAssistant,
      deleteAssistant,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
