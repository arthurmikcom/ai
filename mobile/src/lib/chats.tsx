import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, streamLines, uid } from "./api";
import { useSession } from "./session";
import type { Attachment, Chat, ChatMessage, ChatSummary, StreamEvent } from "./types";

/** A photo picked to go with the next message: shown from `uri`, sent as base64. */
export interface Picked {
  uri: string;
  mime: string;
  data: string;
  name?: string;
}

interface Chats {
  chats: ChatSummary[];
  activeId: string | null;
  messages: ChatMessage[];
  /** The open chat's messages are loading. */
  loading: boolean;
  streaming: boolean;
  open: (id: string | null) => void;
  send: (text: string, opts?: { photos?: Picked[]; image?: boolean }) => void;
  stop: () => void;
  remove: (id: string) => void;
  reloadList: () => void;
}

const Ctx = createContext<Chats | null>(null);

export function useChats(): Chats {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChats must be used inside <ChatsProvider>");
  return ctx;
}

const titleOf = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || "Новый чат";
};

/** The chats of whoever is signed in (a guest's too), and the open one's messages. */
export function ChatsProvider({ children }: { children: ReactNode }) {
  const { me, reload: reloadMe } = useSession();
  const userId = me?.user.id;
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const controller = useRef<AbortController | null>(null);
  // Chats the server has (a new one only once its first message was accepted).
  const saved = useRef(new Set<string>());

  const reloadList = useCallback(() => {
    api<ChatSummary[]>("/api/chats").then(
      (list) => {
        const kept = list.filter((c) => !c.temporary);
        kept.forEach((c) => saved.current.add(c.id));
        setChats(kept);
      },
      () => {},
    );
  }, []);

  // Another account (a guest who signed up, or signed out): its own chats.
  useEffect(() => {
    if (!userId) return;
    controller.current?.abort();
    setActiveId(null);
    setMessages([]);
    reloadList();
  }, [userId, reloadList]);

  const open = useCallback((id: string | null) => {
    controller.current?.abort();
    setActiveId(id);
    setMessages([]);
    if (!id) return;
    setLoading(true);
    api<Chat>(`/api/chats/${id}`)
      .then((chat) => setMessages(chat.messages), () => {})
      .finally(() => setLoading(false));
  }, []);

  const patch = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((list) => list.map((m) => (m.id === id ? fn(m) : m)));

  const send = useCallback(
    (text: string, opts: { photos?: Picked[]; image?: boolean } = {}) => {
      if (controller.current) return;
      const chatId = activeId ?? uid();
      const create = !saved.current.has(chatId);
      const question: ChatMessage = {
        id: uid(),
        role: "user",
        content: text,
        attachments: opts.photos?.map((p): Attachment => ({ mime: p.mime, url: p.uri })),
        createdAt: Date.now(),
      };
      const answerId = uid();
      setActiveId(chatId);
      setMessages((list) => [...list, question, { id: answerId, role: "assistant", content: "", streaming: true, createdAt: Date.now() }]);
      if (create) setChats((list) => [{ id: chatId, title: titleOf(text), createdAt: Date.now(), updatedAt: Date.now() }, ...list.filter((c) => c.id !== chatId)]);

      const abort = new AbortController();
      controller.current = abort;
      setStreaming(true);
      // The answer grows in these and reaches the screen a few times a second (not on every word).
      let content = "";
      let notice = "";
      let status = "";
      const images: Attachment[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        patch(answerId, (m) => ({ ...m, content, notice: notice || undefined, status: status || undefined, attachments: images.length ? [...images] : undefined }));
      };
      const later = () => {
        timer ??= setTimeout(flush, 60);
      };

      void (async () => {
        try {
          const body = {
            chatId,
            create: create ? {} : undefined,
            provider: "maryx",
            model: "maryx",
            image: opts.image || undefined,
            message: {
              id: question.id,
              content: text,
              attachments: opts.photos?.map((p) => ({ mime: p.mime, data: p.data, name: p.name })),
            },
            answerId,
          };
          let accepted = false;
          for await (const event of streamLines<StreamEvent>("/api/chat", body, abort.signal)) {
            if (!accepted) {
              accepted = true;
              saved.current.add(chatId);
            }
            if (event.type === "text") {
              content += event.text;
              status = "";
            } else if (event.type === "notice") notice = notice ? `${notice}\n${event.text}` : event.text;
            else if (event.type === "progress") status = status ? `${status}\n${event.text}` : event.text;
            else if (event.type === "route" && event.retry) {
              content = "";
              notice = "";
              images.length = 0;
            } else if (event.type === "image") images.push({ url: event.url, mime: event.mime });
            else if (event.type === "attached") patch(event.messageId, (m) => ({ ...m, attachments: [{ url: event.url, mime: event.mime }] }));
            else if (event.type === "title") setChats((list) => list.map((c) => (c.id === chatId ? { ...c, title: event.title } : c)));
            else if (event.type === "suggestions") patch(answerId, (m) => ({ ...m, suggestions: event.items }));
            else if (event.type === "error") {
              flush();
              patch(answerId, (m) => ({ ...m, error: event.message, streaming: false }));
            } else if (event.type === "done") {
              flush();
              patch(answerId, (m) => ({ ...m, streaming: false }));
            }
            later();
          }
          if (timer) clearTimeout(timer);
          flush();
        } catch (err) {
          if (timer) clearTimeout(timer);
          flush();
          if (abort.signal.aborted) {
            patch(answerId, (m) => ({ ...m, notice: "Генерация остановлена." }));
          } else {
            patch(answerId, (m) => ({
              ...m,
              error: err instanceof Error ? err.message : String(err),
              errorCode: err instanceof ApiError ? err.code : undefined,
            }));
            // Refused before anything was saved: a new chat isn't kept.
            if (create && !saved.current.has(chatId)) setChats((list) => list.filter((c) => c.id !== chatId));
          }
        } finally {
          patch(answerId, (m) => ({ ...m, streaming: false }));
          if (controller.current === abort) controller.current = null;
          setStreaming(false);
          reloadList();
          // Today's messages left, credits.
          void reloadMe();
        }
      })();
    },
    [activeId, reloadList, reloadMe],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  const remove = useCallback(
    (id: string) => {
      setChats((list) => list.filter((c) => c.id !== id));
      saved.current.delete(id);
      if (id === activeId) open(null);
      api(`/api/chats/${id}`, { method: "DELETE" }).catch(() => reloadList());
    },
    [activeId, open, reloadList],
  );

  return (
    <Ctx.Provider value={{ chats, activeId, messages, loading, streaming, open, send, stop, remove, reloadList }}>{children}</Ctx.Provider>
  );
}
