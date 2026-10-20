import { deleteChat, getChat, updateChat } from "@/lib/server/chats";
import { jsonError, requireUser } from "@/lib/server/http";
import { isSelectable } from "@/lib/server/validate";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const user = await requireUser(request, { guest: true });
  if (user instanceof Response) return user;
  const chat = await getChat(user.id, (await params).id);
  return chat
    ? Response.json(chat, { headers: { "Cache-Control": "no-store" } })
    : jsonError("Чат не найден", 404);
}

/** Rename a chat or switch its model. */
export async function PATCH(request: Request, { params }: Context) {
  const user = await requireUser(request, { guest: true });
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const changes: Parameters<typeof updateChat>[2] = {};
  if (typeof body?.title === "string" && body.title.trim()) changes.title = body.title.trim().slice(0, 120);
  if (isSelectable(body?.provider) && typeof body?.model === "string" && body.model) {
    changes.provider = body.provider;
    changes.model = body.model.slice(0, 200);
  }
  if (Object.keys(changes).length === 0) return jsonError("Нечего менять", 400);
  return (await updateChat(user.id, (await params).id, changes))
    ? Response.json({ ok: true })
    : jsonError("Чат не найден", 404);
}

export async function DELETE(request: Request, { params }: Context) {
  const user = await requireUser(request, { guest: true });
  if (user instanceof Response) return user;
  return (await deleteChat(user.id, (await params).id))
    ? Response.json({ ok: true })
    : jsonError("Чат не найден", 404);
}
