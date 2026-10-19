// «Карты»: what's around a point, from OpenStreetMap's Overpass API. Shared by
// the browser (which asks Overpass itself: the public servers turn away busy
// cloud addresses, a person's own connection is welcome) and the server (the
// fallback, and MARYX's answers).

import type { Place, PlaceCategory } from "@/lib/types";

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

/** Public Overpass servers, tried in turn: each is busy at times. */
export const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Places shown at most, nearest first. */
export const MAX_PLACES = 40;

export function isPlaceCategory(value: unknown): value is PlaceCategory {
  return typeof value === "string" && value in PLACE_CATEGORIES;
}

/** The Overpass query for named places of these categories within `radius` metres. */
export function overpassQuery(lat: number, lon: number, categories: PlaceCategory[], radius: number): string {
  const around = `(around:${radius},${lat},${lon})`;
  const parts = categories.flatMap((c) => PLACE_CATEGORIES[c].tags.map((t) => `nwr${t}["name"]${around};`));
  return `[out:json][timeout:20];(${parts.join("")});out center 80;`;
}

/** Metres between two points. */
export function distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

/** Overpass's answer as places around the point, nearest first; null when it isn't an answer at all. */
export function placesFrom(answer: unknown, lat: number, lon: number, categories: PlaceCategory[]): Place[] | null {
  const elements = (answer as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return null;
  const places: Place[] = [];
  for (const e of elements as OverpassElement[]) {
    const t = e.tags ?? {};
    const at = e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : e.center;
    if (!at || !t.name) continue;
    const category =
      categories.find((c) =>
        PLACE_CATEGORIES[c].tags.some((tag) => {
          const [, k, v] = /\["(.+?)"="(.+?)"\]/.exec(tag) ?? [];
          return t[k] === v;
        }),
      ) ?? categories[0];
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
    .slice(0, MAX_PLACES);
}

/**
 * Asks the Overpass servers in turn until one answers; `headers` say who's
 * asking (the server must, a browser can't set a User-Agent).
 */
export async function askOverpass(
  query: string,
  servers: string[],
  opts: { headers?: Record<string, string>; timeoutMs: number; signal?: AbortSignal },
): Promise<unknown> {
  let failure: unknown = new Error("Overpass: no servers");
  for (const url of servers) {
    opts.signal?.throwIfAborted();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...opts.headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)]) : AbortSignal.timeout(opts.timeoutMs),
      });
      // A busy server answers 429/504, or an HTML page instead of JSON.
      if (res.ok) {
        const answer: unknown = await res.json();
        if (Array.isArray((answer as { elements?: unknown }).elements)) return answer;
      }
      failure = new Error(`Overpass ${res.status} at ${url}`);
    } catch (err) {
      failure = err;
    }
  }
  throw failure;
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
