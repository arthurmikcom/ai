import { jsonError, requireUser } from "@/lib/server/http";
import { runTaskNow } from "@/lib/server/tasks";

export const maxDuration = 150;

/** «Запустить сейчас»: runs the task at once (one chat message); its schedule stays. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const task = await runTaskNow(user.id, (await params).id);
  return task ? Response.json(task) : jsonError("Задача не найдена", 404);
}
