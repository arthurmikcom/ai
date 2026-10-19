"use client";

// «Карты» in the browser: the places around a point straight from Overpass,
// over the person's own connection (the public servers turn busy cloud
// addresses away). When no server answers, the site's server tries.

import { api } from "./api";
import { askOverpass, MAX_PLACES, OVERPASS_SERVERS, overpassQuery, placesFrom } from "@/lib/places";
import type { Place, PlaceCategory } from "@/lib/types";

/** The admin's own Overpass servers, when set at build time (NEXT_PUBLIC_OVERPASS_URL, comma-separated). */
const OWN_SERVERS = process.env.NEXT_PUBLIC_OVERPASS_URL?.split(",").map((u) => u.trim()).filter(Boolean);

const cache = new Map<string, Place[]>();

async function fromBrowser(lat: number, lon: number, categories: PlaceCategory[], radius: number): Promise<Place[]> {
  const key = `${lat},${lon}:${[...categories].sort().join("+")}:${radius}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const answer = await askOverpass(overpassQuery(lat, lon, categories, radius), OWN_SERVERS?.length ? OWN_SERVERS : OVERPASS_SERVERS, {
    timeoutMs: 12_000,
  });
  const places = placesFrom(answer, lat, lon, categories) ?? [];
  cache.set(key, places);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return places;
}

/**
 * The places around the point (and what the spot is called): from the
 * browser first, then through the site's server.
 */
export async function findPlaces(
  lat: number,
  lon: number,
  categories: PlaceCategory[],
  radius = 1500,
): Promise<{ places: Place[]; near: string | null }> {
  const near = api<{ near: string | null }>(`/api/maps/near?lat=${lat}&lon=${lon}`).then(
    (r) => r.near,
    () => null,
  );
  try {
    const places = await fromBrowser(lat, lon, categories, radius);
    return { places: places.slice(0, MAX_PLACES), near: await near };
  } catch {
    return api<{ places: Place[]; near: string | null }>(`/api/maps/places?lat=${lat}&lon=${lon}&categories=${categories.join(",")}&radius=${radius}`);
  }
}
