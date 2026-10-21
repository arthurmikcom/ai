import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { authClient, sessionCookie } from "./auth";
import type { Me } from "./types";

interface Session {
  /** Null until the first answer (or when the server can't be reached). */
  me: Me | null;
  /** The cookie to show the user's pictures with (empty in a browser). */
  cookie: string;
  ready: boolean;
  /** Why the app couldn't start (no connection). */
  error: string | null;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

/** The profile; without a session the app becomes a guest first (like the site's chat). */
async function loadProfile(): Promise<Me> {
  try {
    return await api<Me>("/api/me");
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    const { error } = await authClient.signIn.anonymous();
    if (error) throw new ApiError(error.status ?? 0, error.status === 429 ? "Слишком много попыток — попробуйте через минуту." : "Не удалось открыть чат. Попробуйте ещё раз.");
    return api<Me>("/api/me");
  }
}

export function useSession(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/**
 * Who is using the app. Like the site, someone without an account becomes a
 * guest straight away and can chat; signing up or in keeps their chats.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [cookie, setCookie] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State is set once the answer is in (the first load and every reload).
  const settle = useCallback(
    (load: Promise<Me>) =>
      load
        .then(async (profile) => {
          setError(null);
          setMe(profile);
          setCookie(await sessionCookie());
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setReady(true)),
    [],
  );

  const reload = useCallback(() => settle(loadProfile()), [settle]);

  useEffect(() => {
    void settle(loadProfile());
  }, [settle]);

  const signOut = useCallback(async () => {
    await authClient.signOut().catch(() => {});
    setMe(null);
    // Signed out, the app goes on as a guest (like the site's chat).
    await reload();
  }, [reload]);

  return <Ctx.Provider value={{ me, cookie, ready, error, reload, signOut }}>{children}</Ctx.Provider>;
}
