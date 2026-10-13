"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "./AppState";

/** Field to activate a promo code. */
export function PromoForm() {
  const { refreshMe } = useApp();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const { until } = await api<{ until: number }>("/api/billing/promo", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setMessage({ ok: true, text: `Pro активирован до ${new Date(until).toLocaleDateString("ru-RU")}` });
      setCode("");
      refreshMe();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="NEXUS-XXXX-XXXX"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm uppercase text-zinc-100 outline-none placeholder:normal-case placeholder:text-zinc-600 focus:border-violet-400/50"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
        >
          Активировать
        </button>
      </div>
      {message && (
        <p className={`mt-2 text-sm ${message.ok ? "text-emerald-300" : "text-red-300"}`}>{message.text}</p>
      )}
    </form>
  );
}
