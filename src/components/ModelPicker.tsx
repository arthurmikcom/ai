"use client";

import { Brain, Check, ChevronDown, Search, Sparkles } from "@/components/MaryxIcons";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { providerName } from "@/lib/catalog";
import type { ModelInfo, ProviderId } from "@/lib/types";
import type { ModelChoice } from "./AppState";
import { BrandMark } from "./Design";

interface Props {
  models: ModelInfo[];
  value: ModelChoice | null;
  onChange: (choice: ModelChoice) => void;
  loading?: boolean;
  align?: "left" | "right";
}

export function findModel(models: ModelInfo[], choice: ModelChoice | null): ModelInfo | undefined {
  return choice
    ? models.find((m) => m.provider === choice.provider && m.id === choice.model)
    : undefined;
}

/** In place of the picker when only MARYX is offered: our own AI, nothing to choose. */
export function MaryxBadge({ label = "MARYX" }: { label?: string }) {
  return (
    <div className="maryx-model-badge flex max-w-full items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.025] px-3.5 py-2.5 text-[13px] font-medium text-zinc-100">
      <BrandMark className="!size-6 !rounded-lg" />
      <span className="truncate">{label}</span>
    </div>
  );
}

export function ModelPicker({ models, value, onChange, loading, align = "left" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<ProviderId>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const current = findModel(models, value);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<ProviderId, ModelInfo[]>();
    for (const m of models) {
      if (q && !`${m.label} ${m.id} ${m.description ?? ""}`.toLowerCase().includes(q)) continue;
      map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
    }
    return [...map.entries()];
  }, [models, query]);

  const label = current?.label ?? value?.model ?? (loading ? "Загрузка моделей…" : "Выберите модель");

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex max-w-full items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.025] px-3.5 py-2.5 text-[13px] font-medium text-zinc-100 hover:border-violet-300/20 hover:bg-white/5 sm:max-w-[16rem]"
      >
        <Sparkles className="size-4 shrink-0 text-violet-300" aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-zinc-400" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Выбор модели"
          className={`model-popover fixed inset-x-4 top-20 z-40 overflow-hidden rounded-2xl border border-violet-300/20 sm:absolute sm:inset-x-auto sm:top-full sm:mt-2 sm:w-[min(24rem,calc(100vw-2rem))] ${
            align === "right" ? "sm:right-0" : "sm:left-0"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
            <Search className="size-4 text-zinc-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск модели…"
              aria-label="Поиск модели"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            />
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            {groups.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-zinc-500">
                {models.length === 0 ? "Нет подключённых провайдеров" : "Ничего не найдено"}
              </p>
            )}
            {groups.map(([provider, list]) => {
              const showAll = expanded.has(provider) || query.trim() !== "";
              const featured = list.filter((m) => m.featured);
              const visible = showAll ? list : featured;
              const hidden = list.length - featured.length;
              return (
                <div key={provider} className="mb-1">
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    {providerName(provider)}
                  </div>
                  {visible.map((m) => {
                    const selected = value?.provider === m.provider && value.model === m.id;
                    return (
                      <button
                        key={`${m.provider}:${m.id}`}
                        type="button"
                        onClick={() => {
                          onChange({ provider: m.provider, model: m.id });
                          setOpen(false);
                          setQuery("");
                        }}
                        className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/5 ${
                          selected ? "bg-white/5" : ""
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm text-zinc-100">
                            <span className="truncate">{m.label}</span>
                            {m.reasoning && <Brain className="size-3.5 shrink-0 text-violet-400" />}
                          </div>
                          {m.description ? (
                            <div className="truncate text-xs text-zinc-500">{m.description}</div>
                          ) : m.label !== m.id ? (
                            <div className="truncate font-mono text-[11px] text-zinc-600">{m.id}</div>
                          ) : null}
                        </div>
                        {selected && <Check className="mt-0.5 size-4 shrink-0 text-violet-400" />}
                      </button>
                    );
                  })}
                  {!showAll && hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpanded((s) => new Set(s).add(provider))}
                      className="w-full rounded-xl px-3 py-1.5 text-left text-xs text-violet-300 hover:bg-white/5"
                    >
                      Показать ещё {hidden}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block border-t border-white/10 px-4 py-2.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          >
            Подключить больше провайдеров →
          </Link>
        </div>
      )}
    </div>
  );
}
