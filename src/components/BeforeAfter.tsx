"use client";

import { useState } from "react";

/**
 * A photo before and after an edit, one over the other: drag the line (or use
 * the arrow keys) to compare. `fill`: the pictures cover a box sized by its parent.
 */
export function BeforeAfter({ before, after, fill = false, className = "" }: { before: string; after: string; fill?: boolean; className?: string }) {
  const [split, setSplit] = useState(50);
  const fit = fill ? "object-cover" : "object-contain";
  return (
    <div className={`relative select-none overflow-hidden ${fill ? "size-full" : ""} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- our own stored files */}
      <img src={after} alt="После" className={`${fill ? "absolute inset-0 size-full" : "block max-h-[28rem] max-w-full"} ${fit}`} />
      {/* eslint-disable-next-line @next/next/no-img-element -- our own stored files */}
      <img
        src={before}
        alt="До"
        className={`absolute inset-0 size-full ${fit}`}
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      />
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_8px_rgba(0,0,0,.6)]" style={{ left: `${split}%` }}>
        <div className="absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[11px] font-bold text-zinc-900 shadow-lg">
          ⇆
        </div>
      </div>
      <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">До</span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">После</span>
      <input
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        aria-label="Сравнить до и после"
        className="absolute inset-0 size-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}
