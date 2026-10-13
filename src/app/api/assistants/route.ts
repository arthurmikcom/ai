import { listAssistants, saveAssistant } from "@/lib/server/chats";
import { isValidId, jsonError, requireUser } from "@/lib/server/http";
import { isProvider } from "@/lib/server/validate";
import type { Assistant } from "@/lib/types";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return Response.json(await listAssistants(user.id), { headers: { "Cache-Control": "no-store" } });
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Creates or updates an assistant (the id comes from the browser). */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isValidId(body.id)) return jsonError("Неверный ассистент", 400);

  const assistant: Assistant = {
    id: body.id,
    name: text(body.name, 80),
    emoji: text(body.emoji, 16) || "🤖",
    description: text(body.description, 300),
    systemPrompt: text(body.systemPrompt, 20_000),
    provider: isProvider(body.provider) ? body.provider : undefined,
    model: isProvider(body.provider) ? text(body.model, 200) || undefined : undefined,
    createdAt: typeof body.createdAt === "number" ? body.createdAt : Date.now(),
  };
  if (!assistant.name || !assistant.systemPrompt) return jsonError("Заполните название и инструкцию", 400);

  return (await saveAssistant(user.id, assistant))
    ? Response.json(assistant)
    : jsonError("Ассистент не найден", 404);
}
