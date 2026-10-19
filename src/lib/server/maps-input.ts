// What the «Карты» routes accept: a point on the map and a search radius.

import type { PlaceCategory } from "@/lib/types";
import { isPlaceCategory } from "./places";

/** A point, when both numbers are real coordinates. */
export function pointOf(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  const la = Number(lat);
  const lo = Number(lon);
  if (lat === null || lon === null || lat === "" || lon === "") return null;
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  // ~10 m is close enough, and the same spot hits the same cached answer.
  return { lat: Math.round(la * 10_000) / 10_000, lon: Math.round(lo * 10_000) / 10_000 };
}

/** 500 m … 5 km; 1.5 km by default (a walk). */
export function radiusOf(value: unknown): number {
  const r = Number(value);
  return Number.isFinite(r) && r > 0 ? Math.min(5000, Math.max(500, Math.round(r))) : 1500;
}

export function categoriesOf(value: unknown): PlaceCategory[] {
  const list = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  return [...new Set(list.filter(isPlaceCategory))].slice(0, 6);
}

export const MAPS_DOWN = "Карта сейчас не отвечает. Попробуйте через минуту.";
