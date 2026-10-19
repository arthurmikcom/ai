import { jsonError, requireUser } from "@/lib/server/http";
import { deleteTask, parseSchedule, updateTask } from "@/lib/server/tasks";

/** Pause, resume or edit a task. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const changes: Parameters<typeof updateTask>[2] = {};
  if (typeof body?.active === "boolean") changes.active = body.active;
  if (typeof body?.search === "boolean") changes.search = body.search;
  if (typeof body?.title === "string" && body.title.trim()) changes.title = body.title.trim().slice(0, 80);
  if (typeof body?.prompt === "string") {
    const prompt = body.prompt.trim();
    if (prompt.length < 3 || prompt.length > 2000) return jsonError("Задача — от 3 до 2000 символов", 400);
    changes.prompt = prompt;
  }
  if (body?.schedule !== undefined) {
    const schedule = parseSchedule(body.schedule);
    if (typeof schedule === "string") return jsonError(schedule, 400);
    changes.schedule = schedule;
  }
  const task = await updateTask(user.id, (await params).id, changes);
  if (task === null) return jsonError("Задача не найдена", 404);
  return typeof task === "string" ? jsonError(task, 400) : Response.json(task);
}

/** Deletes a task (its results stay in its chat). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return (await deleteTask(user.id, (await params).id)) ? Response.json({ ok: true }) : jsonError("Задача не найдена", 404);
}
