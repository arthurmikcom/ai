import { jsonError, requireUser } from "@/lib/server/http";
import { setInstructions, userPrefs } from "@/lib/server/maryx";
import type { InstructionsResponse } from "@/lib/types";

/** The signed-in user's personal instructions for every chat. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const { instructions } = await userPrefs(user.id);
  return Response.json(instructions satisfies InstructionsResponse, { headers: { "Cache-Control": "no-store" } });
}

/** Saves them: `{ about: string, style: string }` (up to 1500 characters each). */
export async function PUT(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as { about?: unknown; style?: unknown } | null;
  if (typeof body?.about !== "string" || typeof body.style !== "string") return jsonError("Неверный запрос", 400);
  if (body.about.length > 5000 || body.style.length > 5000) return jsonError("Слишком длинный текст", 400);
  const saved = await setInstructions(user.id, { about: body.about, style: body.style });
  return Response.json(saved satisfies InstructionsResponse);
}
