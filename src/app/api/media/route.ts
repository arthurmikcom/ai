import { mediaSource } from "@/lib/server/media";
import { isProvider } from "@/lib/server/validate";

export const maxDuration = 120;

/**
 * Downloads a generated file for the browser. Replicate links expire after an
 * hour and Google video links need the API key, so the client saves the bytes
 * locally through this endpoint. Only known provider hosts are allowed.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const provider = params.get("provider");
  const source = isProvider(provider) ? mediaSource(provider, params.get("url") ?? "") : null;
  if (!source) return new Response("Недопустимый адрес файла", { status: 400 });

  let upstream = await fetch(source.url, { headers: source.headers, redirect: "manual" });
  // Google answers with a redirect to signed storage; follow it once without
  // our API key so the key never leaves the provider's own host.
  const location = upstream.headers.get("location");
  if (upstream.status >= 300 && upstream.status < 400 && location) {
    const next = new URL(location, source.url);
    if (next.protocol !== "https:") return new Response("Недопустимый редирект", { status: 502 });
    upstream = await fetch(next);
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("Не удалось скачать файл", { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
