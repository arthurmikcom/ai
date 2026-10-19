import { createCharacter, listCharacters, MAX_CHARACTER_PHOTOS } from "@/lib/server/characters";
import { StorageUnavailableError } from "@/lib/server/errors";
import { jsonError, requireUser, storageUnavailable } from "@/lib/server/http";
import { parseCharacter } from "@/lib/server/validate";

/** «Мой персонаж»: the user's characters. */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return Response.json(await listCharacters(user.id));
}

/** Saves a new character: a name and 1–3 photos of the person. */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const parsed = parseCharacter(await request.json().catch(() => null), MAX_CHARACTER_PHOTOS);
  if (typeof parsed === "string") return jsonError(parsed, 400);
  try {
    const made = await createCharacter(user.id, parsed.name, parsed.photos);
    return typeof made === "string" ? jsonError(made, 409) : Response.json(made);
  } catch (err) {
    if (err instanceof StorageUnavailableError) return storageUnavailable(user, err.message);
    throw err;
  }
}
