"use client";

import { Check, LoaderCircle, UserRound } from "@/components/MaryxIcons";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { forgetInstructions } from "@/lib/client/local-ai";
import type { InstructionsResponse } from "@/lib/types";

const MAX = 1500;

const STYLE_PRESETS = ["Кратко и по делу", "Подробно, с примерами", "Обращайся на «ты»", "Как эксперт, с терминами", "Простыми словами"];

/** Personal instructions: who the user is and how answers should look (every chat). */
export function InstructionsSection() {
  const [saved, setSaved] = useState<InstructionsResponse | null>(null);
  const [about, setAbout] = useState("");
  const [style, setStyle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<InstructionsResponse>("/api/instructions").then(
      (r) => {
        setSaved(r);
        setAbout(r.about);
        setStyle(r.style);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  const dirty = saved !== null && (about.trim() !== saved.about || style.trim() !== saved.style);

  const save = async () => {
    setBusy(true);
    setError(null);
    const sent = { about, style };
    try {
      const r = await api<InstructionsResponse>("/api/instructions", {
        method: "PUT",
        body: JSON.stringify(sent),
      });
      setSaved(r);
      forgetInstructions();
      // Text typed while saving stays (and stays unsaved).
      setAbout((cur) => (cur === sent.about ? r.about : cur));
      setStyle((cur) => (cur === sent.style ? r.style : cur));
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const addPreset = (p: string) => {
    if (style.toLowerCase().includes(p.toLowerCase())) return;
    setStyle((s) => (s.trim() ? `${s.trim().replace(/[.,;]$/, "")}. ${p}` : p).slice(0, MAX));
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-4">
      <div className="flex items-start gap-3">
        <UserRound className="mt-0.5 size-5 shrink-0 text-violet-300" />
        <div>
          <div className="font-medium text-zinc-100">Личные инструкции</div>
          <p className="mt-1 text-sm text-zinc-400">
            Работают во всех чатах и со всеми моделями. MARYX учитывает их в каждом ответе.
          </p>
        </div>
      </div>

      {!saved && !error && <LoaderCircle className="mt-4 size-5 animate-spin text-zinc-500" />}
      {saved && (
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm text-zinc-300">Что MARYX стоит знать о вас?</span>
            <textarea
              value={about}
              maxLength={MAX}
              onChange={(e) => setAbout(e.target.value)}
              rows={3}
              placeholder="Например: я дизайнер из Казани, делаю сайты для малого бизнеса, учу английский."
              className="w-full resize-y rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-400/50 focus:outline-none"
            />
            <span className="mt-1 block text-right text-[11px] text-zinc-600">{about.length} / {MAX}</span>
          </label>
          <div>
            <label className="block">
              <span className="mb-1.5 block text-sm text-zinc-300">Как отвечать?</span>
              <textarea
                value={style}
                maxLength={MAX}
                onChange={(e) => setStyle(e.target.value)}
                rows={3}
                placeholder="Например: кратко, с примерами кода, без воды; в конце — вывод одной строкой."
                className="w-full resize-y rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-400/50 focus:outline-none"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {STYLE_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => addPreset(p)}
                  className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-400 hover:border-violet-300/40 hover:text-zinc-100"
                >
                  + {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!dirty || busy}
              onClick={() => void save()}
              className="maryx-button rounded-xl px-4 py-2 text-sm"
            >
              {busy ? "Сохраняю…" : "Сохранить"}
            </button>
            {done && (
              <span className="flex items-center gap-1 text-sm text-emerald-300">
                <Check className="size-4" /> Сохранено
              </span>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
