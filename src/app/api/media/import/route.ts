import { jsonError, requireUser } from "@/lib/server/http";
import { importVideo } from "@/lib/server/gallery";
import { mimeOfKey } from "@/lib/server/storage";
import { isOwnVideoKey } from "@/lib/server/uploads";
import type { AspectRatio } from "@/lib/types";

const RATIOS = new Set<AspectRatio>(["16:9", "9:16", "1:1", "4:3", "3:4"]);

/** «Тренд»: the reel glued in the browser (uploaded beforehand) joins «Мои видео». */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as
    | { key?: unknown; prompt?: unknown; aspectRatio?: unknown; duration?: unknown }
    | null;
  if (typeof body?.key !== "string" || !isOwnVideoKey(user.id, body.key)) return jsonError("Неверное видео", 400);
  const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim().slice(0, 300) : "Мой тренд";
  const aspectRatio = RATIOS.has(body.aspectRatio as AspectRatio) ? (body.aspectRatio as AspectRatio) : "9:16";
  const seconds = Number(body.duration);
  const duration = Number.isFinite(seconds) && seconds > 0 && seconds <= 600 ? Math.round(seconds) : undefined;
  return Response.json(await importVideo(user.id, { key: body.key, mime: mimeOfKey(body.key), prompt, aspectRatio, duration }));
}
