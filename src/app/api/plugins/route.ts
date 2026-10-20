import { isPluginId } from "@/lib/plugins";
import { jsonError, requireUser } from "@/lib/server/http";
import { installedPlugins, setPlugin } from "@/lib/server/plugins";

/** «Плагины»: the ones the user has on. */
export async function GET(request: Request) {
  const user = await requireUser(request, { guest: true });
  if (user instanceof Response) return user;
  return Response.json({ installed: await installedPlugins(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

/** Turns one on or off: { id, on }. */
export async function PUT(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { id?: unknown; on?: unknown } | null;
  if (!isPluginId(body?.id) || typeof body.on !== "boolean") return jsonError("Неизвестный плагин", 400);
  return Response.json({ installed: await setPlugin(user.id, body.id, body.on) });
}
