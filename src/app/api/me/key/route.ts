import { jsonError, requireUser } from "@/lib/server/http";
import { deleteOwnKey, ownKeyInfo, saveOwnKey } from "@/lib/server/own-key";

/** The user's own OpenRouter key (BYOK): only whether one is saved and its last characters. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return Response.json({ key: await ownKeyInfo(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

/** Saves a key after checking it with OpenRouter: { key } → { key: { hint } }. */
export async function PUT(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== "string" || !body.key.trim()) return jsonError("Вставьте ключ OpenRouter", 400);
  const error = await saveOwnKey(user.id, body.key);
  if (error) return jsonError(error, 400);
  return Response.json({ key: await ownKeyInfo(user.id) });
}

export async function DELETE(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  await deleteOwnKey(user.id);
  return Response.json({ key: null });
}
