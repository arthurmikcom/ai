import { createPromo, deletePromo, listPromos } from "@/lib/server/billing/promo";
import { jsonError, requireAdmin } from "@/lib/server/http";

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  return Response.json(await listPromos(), { headers: { "Cache-Control": "no-store" } });
}

/** Creates a code: { days, credits?, maxUses, note?, code? } — code is generated when omitted. */
export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  // Whole numbers only: anything else (null, "1 000", "abc") is refused rather than read as 0.
  const whole = (v: unknown, fallback?: number) =>
    v === undefined || v === "" ? (fallback ?? NaN) : typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  const result = await createPromo({
    code: typeof body?.code === "string" && body.code.trim() ? body.code : undefined,
    days: whole(body?.days),
    credits: whole(body?.credits, 0),
    maxUses: whole(body?.maxUses),
    note: typeof body?.note === "string" ? body.note : undefined,
  });
  return typeof result === "string" ? jsonError(result, 400) : Response.json(result);
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const code = new URL(request.url).searchParams.get("code") ?? "";
  return (await deletePromo(code)) ? Response.json({ ok: true }) : jsonError("Код не найден", 404);
}
