import { requireUser } from "@/lib/server/http";
import { markTasksSeen } from "@/lib/server/tasks";

/** The task list was opened: new results are seen. */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  await markTasksSeen(user.id);
  return Response.json({ ok: true });
}
