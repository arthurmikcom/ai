"use client";

import type { ComponentType } from "react";
import type { PluginId } from "@/lib/plugins";
import {
  Banknote,
  BookOpen,
  Brain,
  CalendarDays,
  Chart,
  Clock,
  Code2,
  Coins,
  FileText,
  Flame,
  GraduationCap,
  Music,
  Package,
  Plane,
  Sun,
  Telescope,
  Trophy,
  type MaryxIconProps,
} from "./MaryxIcons";

const ICONS: Record<PluginId, ComponentType<MaryxIconProps>> = {
  weather: Sun,
  news: FileText,
  time: Clock,
  holidays: CalendarDays,
  currency: Banknote,
  crypto: Coins,
  wikipedia: GraduationCap,
  arxiv: Telescope,
  github: Code2,
  travel: Plane,
  music: Music,
  sports: Trophy,
  stocks: Chart,
  binance: Coins,
  science: Brain,
  books: BookOpen,
  hackernews: Flame,
  packages: Package,
};

/** The app-store tile of a plugin: its glyph on its own colours. */
export function PluginIcon({ id, size = 38 }: { id: PluginId; size?: number }) {
  const Icon = ICONS[id];
  return (
    <span className="plugin-icon" data-plugin={id} style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.55)} />
    </span>
  );
}
