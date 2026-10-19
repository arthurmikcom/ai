import { requireUser } from "@/lib/server/http";
import { runDueTasks } from "@/lib/server/tasks";

export const maxDuration = 150;

/**
 * The open app calls this every minute: the user's tasks that are due run now
 * (a couple at a time, so the call stays short). Returns those that ran.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const ran = await runDueTasks({ userId: user.id, until: Date.now() + 20_000, limit: 2 });
  return Response.json({ ran }, { headers: { "Cache-Control": "no-store" } });
}
