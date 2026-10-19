import { jsonError, requireUser } from "@/lib/server/http";
import { categoriesOf, MAPS_DOWN, pointOf, radiusOf } from "@/lib/server/maps-input";
import { nearby, placeName } from "@/lib/server/places";

export const maxDuration = 60;

/** «Карты»: named places of the chosen kinds around a point, nearest first, and what the spot is called. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const params = new URL(request.url).searchParams;
  const point = pointOf(params.get("lat"), params.get("lon"));
  if (!point) return jsonError("Неверное место на карте", 400);
  const categories = categoriesOf(params.get("categories"));
  if (!categories.length) return jsonError("Выберите, что искать", 400);
  try {
    const [places, near] = await Promise.all([
      nearby(point.lat, point.lon, categories, radiusOf(params.get("radius"))),
      placeName(point.lat, point.lon).catch(() => null),
    ]);
    return Response.json({ places, near });
  } catch (err) {
    console.error("[maps] places", err);
    return jsonError(MAPS_DOWN, 502);
  }
}
