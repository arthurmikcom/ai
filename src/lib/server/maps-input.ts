// What the «Карты» routes accept: a point on the map and a search radius.

import { MAX_PLACES } from "@/lib/places";
import type { Place, PlaceCategory } from "@/lib/types";
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

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

/**
 * Places the browser found itself (straight from OpenStreetMap), checked:
 * real coordinates, known kinds, short words. Null when it isn't such a list.
 */
export function placesOf(value: unknown): Place[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLACES) return null;
  const places: Place[] = [];
  for (const raw of value as Record<string, unknown>[]) {
    if (typeof raw !== "object" || raw === null) return null;
    const at = pointOf(raw.lat, raw.lon);
    const id = text(raw.id, 40);
    const name = text(raw.name, 120);
    const distance = Number(raw.distance);
    if (!at || !id || !name || !isPlaceCategory(raw.category) || !Number.isFinite(distance) || distance < 0 || distance > 50_000) return null;
    const optional = { address: text(raw.address, 160), hours: text(raw.hours, 160), website: text(raw.website, 200), phone: text(raw.phone, 60) };
    places.push({
      id,
      name,
      category: raw.category,
      kind: text(raw.kind, 80) ?? name,
      lat: Number(raw.lat),
      lon: Number(raw.lon),
      distance: Math.round(distance),
      ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
    });
  }
  return places;
}
