// «Карты»: places near the user, from OpenStreetMap (free, no keys): an
// address or city becomes a point (Nominatim), and what's around it comes by
// category (Overpass). Answers are kept a few minutes: both services ask to be
// asked gently.

import type { Place, PlaceCategory } from "@/lib/types";

const NOMINATIM = () => process.env.NOMINATIM_URL?.trim() || "https://nominatim.openstreetmap.org";
/** Overpass servers, tried in turn: the public ones are busy at times. */
const OVERPASS = () =>
  process.env.OVERPASS_URL?.split(",").map((u) => u.trim()).filter(Boolean) ?? [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  ];
/** Both services ask to be told who's asking. */
const HEADERS = { "User-Agent": "MARYX-Ai/1.0 (maps; +https://github.com/arthurmikcom/ai)", "Accept-Language": "ru" };
const CACHE_MS = 10 * 60 * 1000;

/** What each category is in OpenStreetMap's tags. */
export const PLACE_CATEGORIES: Record<PlaceCategory, { label: string; tags: string[] }> = {
  cafe: { label: "Кафе", tags: ['["amenity"="cafe"]'] },
  restaurant: { label: "Ресторан", tags: ['["amenity"="restaurant"]'] },
  fast_food: { label: "Фастфуд", tags: ['["amenity"="fast_food"]'] },
  bar: { label: "Бар", tags: ['["amenity"="bar"]', '["amenity"="pub"]'] },
  pharmacy: { label: "Аптека", tags: ['["amenity"="pharmacy"]'] },
  atm: { label: "Банкомат", tags: ['["amenity"="atm"]', '["amenity"="bank"]'] },
  supermarket: { label: "Магазин", tags: ['["shop"="supermarket"]', '["shop"="convenience"]'] },
  fuel: { label: "АЗС", tags: ['["amenity"="fuel"]'] },
  hotel: { label: "Отель", tags: ['["tourism"="hotel"]', '["tourism"="hostel"]'] },
  museum: { label: "Музей", tags: ['["tourism"="museum"]', '["tourism"="gallery"]'] },
  park: { label: "Парк", tags: ['["leisure"="park"]'] },
  sight: { label: "Достопримечательность", tags: ['["tourism"="attraction"]', '["tourism"="viewpoint"]', '["historic"="monument"]'] },
};

export function isPlaceCategory(value: unknown): value is PlaceCategory {
  return typeof value === "string" && value in PLACE_CATEGORIES;
}

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

/** Metres between two points. */
function distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function overpass(query: string): Promise<{ elements?: OverpassElement[] }> {
  let failure: unknown;
  for (const url of OVERPASS()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return (await res.json()) as { elements?: OverpassElement[] };
      failure = new Error(`Overpass ${res.status}`);
    } catch (err) {
      failure = err;
    }
  }
  throw failure;
}

/** Named places of these categories within `radius` metres, nearest first. */
export function nearby(lat: number, lon: number, categories: PlaceCategory[], radius = 1500): Promise<Place[]> {
  const key = `near:${lat.toFixed(4)},${lon.toFixed(4)}:${[...categories].sort().join("+")}:${radius}`;
  return cached(key, async () => {
    const around = `(around:${radius},${lat},${lon})`;
    const parts = categories.flatMap((c) => PLACE_CATEGORIES[c].tags.map((t) => `nwr${t}["name"]${around};`));
    const query = `[out:json][timeout:20];(${parts.join("")});out center 80;`;
    const { elements = [] } = await overpass(query);
    const places: Place[] = [];
    for (const e of elements) {
      const t = e.tags ?? {};
      const at = e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : e.center;
      if (!at || !t.name) continue;
      const category = categories.find((c) => PLACE_CATEGORIES[c].tags.some((tag) => {
        const [, k, v] = /\["(.+?)"="(.+?)"\]/.exec(tag) ?? [];
        return t[k] === v;
      })) ?? categories[0];
      const address = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ");
      places.push({
        id: `${e.type[0]}${e.id}`,
        name: t.name,
        category,
        kind: t.cuisine ? `${PLACE_CATEGORIES[category].label} · ${t.cuisine.split(";")[0].replace(/_/g, " ")}` : PLACE_CATEGORIES[category].label,
        lat: at.lat,
        lon: at.lon,
        distance: distance(lat, lon, at.lat, at.lon),
        ...(address ? { address } : {}),
        ...(t.opening_hours ? { hours: t.opening_hours } : {}),
        ...(t.website || t["contact:website"] ? { website: t.website || t["contact:website"] } : {}),
        ...(t.phone || t["contact:phone"] ? { phone: t.phone || t["contact:phone"] } : {}),
      });
    }
    // One place can be tagged twice (a node and a building): the nearer stays.
    const seen = new Set<string>();
    return places
      .sort((a, b) => a.distance - b.distance)
      .filter((p) => {
        const k = `${p.name}|${p.category}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 40);
  });
}

/** Which categories a question is about ("где выпить кофе" → кафе); a general one gets a mix. */
export function categoriesFor(question: string): PlaceCategory[] {
  const q = question.toLowerCase();
  const found: PlaceCategory[] = [];
  const add = (c: PlaceCategory, re: RegExp) => re.test(q) && found.push(c);
  add("cafe", /кофе|кафе|кофейн|десерт|выпечк|завтрак|coffee|cafe/);
  add("restaurant", /ресторан|поесть|пообедать|поужинать|ужин|обед|еда|кухн|пицц|суши|стейк|бургер|restaurant|food|eat/);
  add("fast_food", /фастфуд|быстро поесть|бургер|шаверм|шаурм|пицц|fast food/);
  add("bar", /бар|паб|пиво|коктейл|вино|bar|pub/);
  add("pharmacy", /аптек|лекарств|pharmacy/);
  add("atm", /банкомат|снять деньги|банк|atm|cash/);
  add("supermarket", /магазин|продукт|супермаркет|купить|shop|grocery/);
  add("fuel", /азс|заправ|бензин|fuel|gas station/);
  add("hotel", /отел|гостиниц|хостел|переночевать|ночлег|hotel/);
  add("museum", /музе|выставк|галере|museum|gallery/);
  add("park", /парк|прогул|погулять|природ|сквер|park|walk/);
  add("sight", /достопримечат|посмотреть|что посмотреть|памятник|экскурс|интересн|куда сходить|sight|attraction/);
  if (/дет|ребён|ребен|с семьёй|с семьей/.test(q)) found.push("park", "museum", "cafe");
  return found.length ? [...new Set(found)] : ["cafe", "restaurant", "park", "sight"];
}
