import { jsonError, requireUser } from "@/lib/server/http";
import { getFile, mimeOfKey, userPrefix } from "@/lib/server/storage";

/** Serves a stored file to its owner only. */
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const key = (await params).key.join("/");
  if (!key.startsWith(userPrefix(user.id))) return jsonError("Нет доступа", 403);

  const file = await getFile(key);
  if (!file) return jsonError("Файл не найден", 404);
  return new Response(file.body, {
    headers: {
      "Content-Type": mimeOfKey(key),
      ...(file.size ? { "Content-Length": String(file.size) } : {}),
      // Keys are unique and never rewritten.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
