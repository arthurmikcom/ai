import { jsonError, requireUser } from "@/lib/server/http";
import { createTask, isTimeZone, listTasks, parseSchedule } from "@/lib/server/tasks";

/** «Задачи»: the user's scheduled tasks. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return Response.json(await listTasks(user.id), { headers: { "Cache-Control": "no-store" } });
}

/** A short name from the task's words (the first few). */
function titleOf(prompt: string): string {
  const words = prompt.replace(/\s+/g, " ").trim();
  const cut = words.length <= 60 ? words : `${words.slice(0, 60).replace(/\s+\S*$/, "")}…`;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 3) return jsonError("Опишите задачу словами", 400);
  if (prompt.length > 2000) return jsonError("Задача слишком длинная: до 2000 символов", 400);
  const schedule = parseSchedule(body?.schedule);
  if (typeof schedule === "string") return jsonError(schedule, 400);
  const timezone = typeof body?.timezone === "string" && isTimeZone(body.timezone) ? body.timezone : "Europe/Moscow";
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 80) : titleOf(prompt);
  const made = await createTask(user.id, { title, prompt, schedule, timezone, search: body?.search === true });
  return typeof made === "string" ? jsonError(made, 400) : Response.json(made);
}
