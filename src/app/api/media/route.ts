import { listMedia } from "@/lib/server/gallery";
import { jsonError, requireUser } from "@/lib/server/http";

/** The user's gallery for one kind (?kind=image|video). */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "image" && kind !== "video") return jsonError("Неверный тип", 400);
  return Response.json(await listMedia(user.id, kind), { headers: { "Cache-Control": "no-store" } });
}
