"use client";

import { ExternalLink, KeyRound, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { forgetModels } from "@/lib/client/useModels";
import { useApp } from "./AppState";

/**
 * BYOK: the user's own OpenRouter key. With it, their OpenRouter requests go
 * out on their account, without the plan's limits.
 */
export function OwnKeySection() {
  const { me, refreshMe } = useApp();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!me) return null;
  const saved = me.ownKey;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/me/key", { method: "PUT", body: JSON.stringify({ key }) });
      setKey("");
      setMessage({ ok: true, text: "Ключ проверен и сохранён. Запросы через OpenRouter теперь идут за ваш счёт." });
      forgetModels();
      refreshMe();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!confirm("Удалить ключ? Запросы снова будут считаться по вашему тарифу.")) return;
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/me/key", { method: "DELETE" });
      forgetModels();
      refreshMe();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-violet-300" />
        <div className="min-w-0">
          <div className="font-medium text-zinc-100">Свой ключ OpenRouter</div>
          <p className="mt-1 text-sm text-zinc-400">
            Для тех, у кого есть свой аккаунт OpenRouter. С ключом MARYX, модели OpenRouter, картинки, видео и голосовой
            ввод работают за ваш счёт в OpenRouter — без дневных лимитов тарифа. Ключ хранится зашифрованным и никогда не
            показывается снова.
          </p>
        </div>
      </div>

      {saved ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-emerald-400/10 px-2.5 py-1 text-sm text-emerald-200">
            Подключён ключ <span className="font-mono">{saved.hint}</span>
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="rounded-xl border border-white/10 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/5 disabled:opacity-50"
          >
            Удалить ключ
          </button>
        </div>
      ) : (
        <form onSubmit={save} className="mt-4 flex flex-wrap gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-or-v1-…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Ключ OpenRouter"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-400/50"
          />
          <button type="submit" disabled={busy || !key.trim()} className="maryx-button rounded-xl px-4 py-2 text-sm">
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : "Проверить и сохранить"}
          </button>
        </form>
      )}
      {!saved && (
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
        >
          Где взять ключ <ExternalLink className="size-3" />
        </a>
      )}
      {message && <p className={`mt-3 text-sm ${message.ok ? "text-emerald-300" : "text-red-300"}`}>{message.text}</p>}
    </div>
  );
}
