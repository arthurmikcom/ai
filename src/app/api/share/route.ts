import { jsonError, requireUser } from "@/lib/server/http";
import { createShare, MAX_SHARE_CHARS } from "@/lib/server/shares";

/** "Поделиться": stores a page made in the chat and returns its public link (/s/<id>). */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { title?: unknown; html?: unknown } | null;
  const html = typeof body?.html === "string" ? body.html : "";
  const title = (typeof body?.title === "string" ? body.title.trim() : "").slice(0, 120) || "Приложение";
  if (!html.trim()) return jsonError("Нечем поделиться", 400);
  if (html.length > MAX_SHARE_CHARS) return jsonError("Страница слишком большая, чтобы ею поделиться", 413);
  const id = await createShare(user.id, title, html);
  if (!id) return jsonError("Сегодня ссылок уже много — попробуйте завтра", 429);
  return Response.json({ url: `/s/${id}` });
}
