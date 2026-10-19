import { jsonError, requireUser } from "@/lib/server/http";
import { pointOf } from "@/lib/server/maps-input";
import { placeName } from "@/lib/server/places";

/** «Карты»: what the spot is called (a district, a city), while the browser finds the places itself. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const params = new URL(request.url).searchParams;
  const point = pointOf(params.get("lat"), params.get("lon"));
  if (!point) return jsonError("Неверное место на карте", 400);
  return Response.json({ near: await placeName(point.lat, point.lon).catch(() => null) });
}
