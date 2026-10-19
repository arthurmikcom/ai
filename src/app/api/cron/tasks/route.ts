import { purgeTemporaryChats } from "@/lib/server/chats";
import { runDueTasks } from "@/lib/server/tasks";

export const maxDuration = 300;

/**
 * Runs everyone's due scheduled tasks and clears old temporary chats. Called
 * by Vercel's daily cron (vercel.json) and, for tasks on time, by any outside
 * pinger every few minutes — both with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const purged = await purgeTemporaryChats().catch((e) => {
    console.error("[cron] temporary chats", e);
    return 0;
  });
  const ran = await runDueTasks({ until: Date.now() + 240_000, limit: 100 });
  console.log("[cron] tasks", { ran: ran.length, purged });
  return Response.json({ ran: ran.length, purged });
}
