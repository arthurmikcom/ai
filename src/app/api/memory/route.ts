import { jsonError, requireUser } from "@/lib/server/http";
import { deleteFacts, listFacts, memoryEnabled, setMemoryEnabled } from "@/lib/server/nexus";
import type { MemoryResponse } from "@/lib/types";

async function current(userId: string): Promise<MemoryResponse> {
  const [enabled, facts] = await Promise.all([memoryEnabled(userId), listFacts(userId)]);
  return { enabled, facts: facts.map((f) => ({ id: f.id, text: f.text, createdAt: f.createdAt.getTime() })) };
}

/** What Nexus remembers about the signed-in user. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return Response.json(await current(user.id), { headers: { "Cache-Control": "no-store" } });
}

/** Turns memory on or off: `{ enabled: boolean }`. */
export async function PATCH(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") return jsonError("Неверный запрос", 400);
  await setMemoryEnabled(user.id, body.enabled);
  return Response.json(await current(user.id));
}

/** Forgets one fact (`?id=…`) or everything. */
export async function DELETE(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const id = new URL(request.url).searchParams.get("id");
  if (id !== null && !/^[\w-]{1,64}$/.test(id)) return jsonError("Неверный идентификатор", 400);
  await deleteFacts(user.id, id ? [id] : undefined);
  return Response.json(await current(user.id));
}
