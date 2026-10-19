import { describeAiError } from "@/lib/server/brand";
import { jsonError, requireUser } from "@/lib/server/http";
import { MAPS_DOWN, placesOf, pointOf, radiusOf } from "@/lib/server/maps-input";
import { recommendPlaces } from "@/lib/server/maryx";
import { ownKey } from "@/lib/server/own-key";
import { categoriesFor, nearby, placeName } from "@/lib/server/places";
import { isTimeZone } from "@/lib/server/tasks";
import { charge, deniedResponse, refundCharge, reserve, settleCharge } from "@/lib/server/usage";
import type { Place } from "@/lib/types";

export const maxDuration = 90;

/** A fast model reading a short list: a few cents at most. */
const ASK_HOLD_USD = 0.02;
/** Enough choice for MARYX, short enough to read quickly. */
const MAX_PLACES = 25;

/**
 * «Карты»: "где выпить кофе рядом?" — MARYX picks from the real places around
 * the point (OpenStreetMap), never invented ones, and says why. It counts as
 * one chat message.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as
    | { question?: unknown; lat?: unknown; lon?: unknown; radius?: unknown; timezone?: unknown; places?: unknown; near?: unknown }
    | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const point = pointOf(body?.lat, body?.lon);
  if (question.length < 2) return jsonError("Напишите, что ищете", 400);
  if (question.length > 500) return jsonError("Вопрос слишком длинный: до 500 символов", 400);
  if (!point) return jsonError("Сначала выберите место на карте", 400);
  const zone = typeof body?.timezone === "string" && isTimeZone(body.timezone) ? body.timezone : "UTC";

  // The places first: when there's nothing around, there's nothing to pay for. The browser
  // usually found them itself (the map's servers turn busy cloud addresses away).
  const categories = categoriesFor(question);
  const found = body?.places === undefined ? null : placesOf(body.places);
  if (body?.places !== undefined && !found) return jsonError("Неверный список мест", 400);
  let places: Place[];
  let near: string | null;
  if (found) {
    places = found;
    near = typeof body?.near === "string" && body.near.trim() ? body.near.trim().slice(0, 120) : await placeName(point.lat, point.lon).catch(() => null);
  } else {
    try {
      const radius = radiusOf(body?.radius);
      [places, near] = await Promise.all([
        nearby(point.lat, point.lon, categories, radius).then((list) =>
          list.length >= 3 || radius >= 4000 ? list : nearby(point.lat, point.lon, categories, 4000),
        ),
        placeName(point.lat, point.lon).catch(() => null),
      ]);
    } catch (err) {
      console.error("[maps] ask", err);
      return jsonError(MAPS_DOWN, 502);
    }
  }
  if (!places.length) {
    return Response.json({
      answer: "Рядом не нашлось подходящих мест. Попробуйте другое место на карте или спросите иначе.",
      picks: [],
      places: [],
      categories,
      near,
    });
  }
  places = places.slice(0, MAX_PLACES);

  const key = await ownKey(user.id);
  const paid = await charge(user, "chat", key);
  if ("denied" in paid) return deniedResponse(user, "chat", paid.denied, { ownKey: Boolean(key) });
  let refused;
  try {
    refused = await reserve(paid, ASK_HOLD_USD, { provider: "openrouter", model: "maps" });
  } catch (err) {
    await refundCharge(paid);
    throw err;
  }
  if (refused) {
    await refundCharge(paid);
    return deniedResponse(user, "chat", refused, { ownKey: Boolean(key), charge: paid });
  }
  try {
    const now = new Date().toLocaleString("ru-RU", { timeZone: zone, weekday: "long", hour: "2-digit", minute: "2-digit" });
    const { answer, picks } = await recommendPlaces(
      { question, near: near ?? `${point.lat}, ${point.lon}`, now, places },
      { userId: user.id, paidBy: paid.paidBy, key: paid.key },
    );
    if (!answer && !picks.length) throw new Error("MARYX не смог ответить. Попробуйте ещё раз.");
    await settleCharge(paid, []);
    return Response.json({ answer, picks, places, categories, near });
  } catch (err) {
    await refundCharge(paid);
    console.error("[maps] ask", err);
    return jsonError(describeAiError(err), 502);
  }
}
