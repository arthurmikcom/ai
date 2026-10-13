import { listChats } from "@/lib/server/chats";
import { requireUser } from "@/lib/server/http";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return Response.json(await listChats(user.id), { headers: { "Cache-Control": "no-store" } });
}
