import { isAdmin } from "@/lib/server/auth";
import { deleteMedia, refreshMedia } from "@/lib/server/gallery";
import { jsonError, requireUser } from "@/lib/server/http";

type Context = { params: Promise<{ id: string }> };

export const maxDuration = 120;

/** Current state of a gallery item; checks the provider while it's pending. */
export async function GET(request: Request, { params }: Context) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const item = await refreshMedia(user.id, (await params).id, isAdmin(user));
  return item
    ? Response.json(item, { headers: { "Cache-Control": "no-store" } })
    : jsonError("Не найдено", 404);
}

export async function DELETE(request: Request, { params }: Context) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return (await deleteMedia(user.id, (await params).id))
    ? Response.json({ ok: true })
    : jsonError("Не найдено", 404);
}
