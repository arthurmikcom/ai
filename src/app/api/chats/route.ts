import { listChats, purgeTemporaryChats, searchChats } from "@/lib/server/chats";
import { jsonError, requireUser } from "@/lib/server/http";

/** The user's chats; with ?q=, the ids of those whose title or messages contain it. */
export async function GET(request: Request) {
  const user = await requireUser(request, { guest: true });
  if (user instanceof Response) return user;
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (query !== undefined) {
    if (query.length < 2 || query.length > 200) return jsonError("Введите от 2 до 200 символов", 400);
    return Response.json({ ids: await searchChats(user.id, query) }, { headers: { "Cache-Control": "no-store" } });
  }
  // Temporary chats left behind (the tab was closed) go after a day.
  await purgeTemporaryChats(user.id).catch((e) => console.error("[chats] purge failed", e));
  return Response.json(await listChats(user.id), { headers: { "Cache-Control": "no-store" } });
}
