// «Карты» on the server: an address or city becomes a point (Nominatim), and
// what's around it comes by category (Overpass) when the browser couldn't ask
// itself. Answers are kept a few minutes: both services ask to be asked gently.

import { askOverpass, OVERPASS_SERVERS, overpassQuery, placesFrom } from "@/lib/places";
import type { Place, PlaceCategory } from "@/lib/types";

export { categoriesFor, isPlaceCategory, PLACE_CATEGORIES } from "@/lib/places";

const NOMINATIM = () => process.env.NOMINATIM_URL?.trim() || "https://nominatim.openstreetmap.org";
/** Overpass servers, tried in turn (OVERPASS_URL: one or several, comma-separated). */
const OVERPASS = () => {
  const own = process.env.OVERPASS_URL?.split(",").map((u) => u.trim()).filter(Boolean);
  return own?.length ? own : OVERPASS_SERVERS;
};
/** Both services ask to be told who's asking. */
const HEADERS = { "User-Agent": "MARYX-Ai/1.0 (maps; +https://github.com/arthurmikcom/ai)", "Accept-Language": "ru" };
const CACHE_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

/** A city, address or place name as a point on the map; null when nothing is found. */
export function geocode(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
  return cached(`geo:${query.toLowerCase()}`, async () => {
    const url = `${NOMINATIM()}/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name.split(",").slice(0, 2).join(",").trim() } : null;
  });
}

/** What the point is called (a district, a city), for "Рядом с …". */
export function placeName(lat: number, lon: number): Promise<string | null> {
  return cached(`rev:${lat.toFixed(3)},${lon.toFixed(3)}`, async () => {
    const url = `${NOMINATIM()}/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const hit = (await res.json()) as { address?: Record<string, string>; display_name?: string };
    const a = hit.address ?? {};
    return [a.suburb || a.neighbourhood || a.road, a.city || a.town || a.village].filter(Boolean).join(", ") || hit.display_name || null;
  });
}

/** Named places of these categories within `radius` metres, nearest first. */
export function nearby(lat: number, lon: number, categories: PlaceCategory[], radius = 1500): Promise<Place[]> {
  const key = `near:${lat.toFixed(4)},${lon.toFixed(4)}:${[...categories].sort().join("+")}:${radius}`;
  return cached(key, async () => {
    const answer = await askOverpass(overpassQuery(lat, lon, categories, radius), OVERPASS(), { headers: HEADERS, timeoutMs: 15_000 });
    return placesFrom(answer, lat, lon, categories) ?? [];
  });
}
