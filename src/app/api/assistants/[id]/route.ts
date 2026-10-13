import { deleteAssistant } from "@/lib/server/chats";
import { jsonError, requireUser } from "@/lib/server/http";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return (await deleteAssistant(user.id, (await params).id))
    ? Response.json({ ok: true })
    : jsonError("Ассистент не найден", 404);
}
