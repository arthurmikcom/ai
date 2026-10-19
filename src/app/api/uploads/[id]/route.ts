import { StorageUnavailableError } from "@/lib/server/errors";
import { jsonError, requireUser, storageUnavailable } from "@/lib/server/http";
import { deleteFiles, putFile } from "@/lib/server/storage";
import { isUploadId, maxParts, partKey, UPLOAD_PART_BYTES } from "@/lib/server/uploads";

export const maxDuration = 60;

/** One part of a video (?part=0, 1, …), its bytes as the body. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const id = (await params).id;
  const part = Number(new URL(request.url).searchParams.get("part"));
  if (!isUploadId(id) || !Number.isInteger(part) || part < 0 || part >= maxParts()) return jsonError("Неверная часть", 400);
  const bytes = Buffer.from(await request.arrayBuffer());
  if (!bytes.length || bytes.length > UPLOAD_PART_BYTES) return jsonError("Неверный размер части", 400);
  try {
    await putFile(partKey(user.id, id, part), bytes, "application/octet-stream");
  } catch (err) {
    if (err instanceof StorageUnavailableError) return storageUnavailable(user, err.message);
    throw err;
  }
  return Response.json({ ok: true });
}

/** A cancelled upload: its parts go. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const id = (await params).id;
  if (!isUploadId(id)) return jsonError("Неверная загрузка", 400);
  await deleteFiles(Array.from({ length: maxParts() }, (_, i) => partKey(user.id, id, i)));
  return Response.json({ ok: true });
}
