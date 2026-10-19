"use client";

import { Check } from "lucide-react";
import { ACCENTS, TEXT_SIZES, THEMES, type Theme } from "@/lib/appearance";
import { useAppearance } from "@/lib/client/appearance";

/** A small picture of a theme (its own colours, whatever the current one is). */
function ThemePreview({ theme }: { theme: Theme }) {
  const half = (light: boolean) => {
    const [bg, side, card, line] = light ? ["#f7f6fb", "#efedf6", "#ffffff", "#d8d4e5"] : ["#09080f", "#100e18", "#1a1627", "#2c2738"];
    return (
      <div className="flex h-full" style={{ background: bg }}>
        <div className="w-1/4" style={{ background: side }} />
        <div className="flex flex-1 flex-col gap-1.5 p-2">
          <div className="h-1.5 w-2/3 rounded-full" style={{ background: line }} />
          <div className="h-1.5 w-1/2 rounded-full" style={{ background: line }} />
          <div className="mt-auto h-4 rounded-md border" style={{ background: card, borderColor: "var(--color-violet-400)" }} />
        </div>
      </div>
    );
  };
  if (theme !== "system") return half(theme === "light");
  return (
    <div className="relative h-full">
      {half(false)}
      <div className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
        {half(true)}
      </div>
    </div>
  );
}

/** Settings → «Оформление»: theme, accent colour and text size (kept on this device). */
export function AppearanceSection() {
  const [look, setLook] = useAppearance();
  return (
    <div className="surface-card rounded-2xl p-5 md:p-7">
      <div role="radiogroup" aria-label="Тема" className="grid grid-cols-3 gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={look.theme === t.id}
            onClick={() => setLook({ theme: t.id })}
            className={`overflow-hidden rounded-xl border text-left transition ${
              look.theme === t.id ? "border-violet-400 ring-2 ring-violet-400/30" : "border-white/10 hover:border-violet-300/40"
            }`}
          >
            <div className="h-16 sm:h-20">
              <ThemePreview theme={t.id} />
            </div>
            <div className="flex items-center justify-between gap-1 px-3 py-2 text-sm text-zinc-200">
              {t.label}
              {look.theme === t.id && <Check className="size-4 shrink-0 text-violet-300" />}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">Цвет</div>
      <div role="radiogroup" aria-label="Цвет" className="mt-3 flex flex-wrap gap-3">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={look.accent === a.id}
            aria-label={a.label}
            title={a.label}
            onClick={() => setLook({ accent: a.id })}
            className={`flex size-10 items-center justify-center rounded-full border-2 transition hover:scale-110 ${
              look.accent === a.id ? "border-zinc-100" : "border-transparent"
            }`}
          >
            <span className="flex size-7 items-center justify-center rounded-full" style={{ background: `linear-gradient(135deg, ${a.color}, color-mix(in oklab, ${a.color} 60%, #000))` }}>
              {look.accent === a.id && <Check className="size-4 text-[#fff]" />}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">Размер текста</div>
      <div role="radiogroup" aria-label="Размер текста" className="mt-3 inline-flex rounded-xl bg-white/[0.04] p-1">
        {TEXT_SIZES.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={look.text === t.id}
            onClick={() => setLook({ text: t.id })}
            className={`rounded-lg px-3 py-1.5 transition ${["text-xs", "text-sm", "text-base"][i]} ${
              look.text === t.id ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-zinc-500">Оформление сохраняется на этом устройстве.</p>
    </div>
  );
}
