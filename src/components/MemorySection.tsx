"use client";

import { Brain, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { MemoryResponse } from "@/lib/types";

/** What Nexus remembers about the user: view, delete, turn off. */
export function MemorySection() {
  const [memory, setMemory] = useState<MemoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<MemoryResponse>("/api/memory").then(setMemory, (e: Error) => setError(e.message));
  }, []);

  const run = async (path: string, init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      setMemory(await api<MemoryResponse>(path, init));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Brain className="mt-0.5 size-5 shrink-0 text-violet-300" />
          <div>
            <div className="font-medium text-zinc-100">Память Nexus</div>
            <p className="mt-1 text-sm text-zinc-400">
              Nexus запоминает важное о вас — имя, работу, предпочтения — и учитывает это в ответах.
            </p>
          </div>
        </div>
        {memory && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={memory.enabled}
              disabled={busy}
              onChange={(e) => void run("/api/memory", { method: "PATCH", body: JSON.stringify({ enabled: e.target.checked }) })}
              className="accent-violet-500"
            />
            Запоминать
          </label>
        )}
      </div>

      {!memory && !error && <LoaderCircle className="mt-4 size-5 animate-spin text-zinc-500" />}
      {memory && memory.facts.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">
          {memory.enabled ? "Пока ничего. Расскажите о себе в чате с Nexus — например, «меня зовут Артур»." : "Память выключена."}
        </p>
      )}
      {memory && memory.facts.length > 0 && (
        <>
          <ul className="mt-4 divide-y divide-white/5">
            {memory.facts.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2 text-sm text-zinc-200">
                <span className="min-w-0 flex-1">{f.text}</span>
                <button
                  type="button"
                  title="Забыть"
                  aria-label={`Забыть: ${f.text}`}
                  disabled={busy}
                  onClick={() => void run(`/api/memory?id=${encodeURIComponent(f.id)}`, { method: "DELETE" })}
                  className="text-zinc-500 hover:text-red-300 disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm("Стереть всё, что Nexus знает о вас?")) void run("/api/memory", { method: "DELETE" });
            }}
            className="mt-3 text-xs text-zinc-500 hover:text-red-300 disabled:opacity-50"
          >
            Стереть всё
          </button>
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
