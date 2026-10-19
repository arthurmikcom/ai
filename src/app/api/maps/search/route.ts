import { jsonError, requireUser } from "@/lib/server/http";
import { MAPS_DOWN } from "@/lib/server/maps-input";
import { geocode } from "@/lib/server/places";

/** «Карты»: a city, an address or a place name → a point on the map. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 200) return jsonError("Напишите город, адрес или место", 400);
  try {
    const found = await geocode(q);
    if (!found) return jsonError(`Не нашёл «${q}» на карте. Попробуйте написать иначе.`, 404);
    return Response.json(found);
  } catch (err) {
    console.error("[maps] search", err);
    return jsonError(MAPS_DOWN, 502);
  }
}
