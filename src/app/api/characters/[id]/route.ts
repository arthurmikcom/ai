import { deleteCharacter } from "@/lib/server/characters";
import { jsonError, requireUser } from "@/lib/server/http";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return (await deleteCharacter(user.id, (await params).id))
    ? Response.json({ ok: true })
    : jsonError("Персонаж не найден", 404);
}
