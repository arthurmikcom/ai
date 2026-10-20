import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Signing in (/api/auth) and the owner's setup check (/api/health, which reports only
// whether settings are present) work without a session.
const PUBLIC_API = ["/api/auth", "/api/health"];
/** Called by payment providers and Vercel Cron; each route authenticates itself. */
const MACHINE_PATHS = [
  "/api/billing/stripe/webhook",
  "/api/billing/paddle/webhook",
  "/api/billing/paypal/webhook",
  "/api/billing/yookassa/webhook",
  "/api/cron",
];

const matches = (pathname: string, paths: string[]) =>
  paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Optional site-wide password (APP_PASSWORD), e.g. for a closed beta. */
function passwordGate(request: NextRequest): NextResponse | null {
  const password = process.env.APP_PASSWORD;
  if (!password) return null;
  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      if (safeEqual(decoded.slice(decoded.indexOf(":") + 1), password)) return null;
    } catch {
      // malformed header
    }
  }
  return new NextResponse("Требуется пароль", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="MARYX Ai", charset="UTF-8"' },
  });
}

/**
 * Every page opens without signing in, like ChatGPT's: a visitor becomes a
 * guest who can chat, and the other sections ask them to sign in or up (the
 * pages hold no data of their own). The API needs a session; this only looks
 * at the cookie (fast), and every route still verifies the session itself.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (matches(pathname, MACHINE_PATHS)) return NextResponse.next();

  const blocked = passwordGate(request);
  if (blocked) return blocked;

  if (!pathname.startsWith("/api/") || matches(pathname, PUBLIC_API) || getSessionCookie(request)) return NextResponse.next();
  return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });
}

export const config = {
  // Vercel's own routes (/_vercel/…, e.g. Speed Insights) need no sign-in.
  matcher: ["/((?!_next/static|_next/image|_vercel|favicon.ico).*)"],
};
