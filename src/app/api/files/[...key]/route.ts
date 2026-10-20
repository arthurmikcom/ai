import { jsonError, requireUser } from "@/lib/server/http";
import { getFile, getFileRange, mimeOfKey, userPrefix } from "@/lib/server/storage";

/** Serves a stored file to its owner only. */
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const user = await requireUser(request, { guest: true });
  if (user instanceof Response) return user;
  const key = (await params).key.join("/");
  if (!key.startsWith(userPrefix(user.id))) return jsonError("Нет доступа", 403);

  const mime = mimeOfKey(key);
  // A video plays and seeks in parts (Safari asks for nothing else).
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && /^(video|audio)\//.test(mime)) {
    const part = await getFileRange(key, Number(range[1]), range[2] ? Number(range[2]) : undefined);
    if (!part) return jsonError("Файл не найден", 404);
    return new Response(part.status === 416 ? null : part.body, {
      status: part.status,
      headers: {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
        ...part.headers,
      },
    });
  }

  const file = await getFile(key);
  if (!file) return jsonError("Файл не найден", 404);
  // Images, video and PDFs open in the browser; other documents download.
  const inline = /^(image|video)\//.test(mime) || mime === "application/pdf";
  return new Response(file.body, {
    headers: {
      "Content-Type": mime,
      "X-Content-Type-Options": "nosniff",
      ...(inline ? {} : { "Content-Disposition": "attachment" }),
      ...(/^(video|audio)\//.test(mime) ? { "Accept-Ranges": "bytes" } : {}),
      ...(file.size ? { "Content-Length": String(file.size) } : {}),
      // Keys are unique and never rewritten.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
