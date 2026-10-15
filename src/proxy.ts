import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// /api/health is the owner's setup check; it reports only whether settings are present.
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/health"];
/** Called by payment providers and Vercel Cron; each route authenticates itself. */
const MACHINE_PATHS = ["/api/billing/stripe/webhook", "/api/billing/yookassa/webhook", "/api/cron"];

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
 * Sends visitors without a session to the login page. This only looks at the
 * cookie (fast); every API route still verifies the session itself.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (matches(pathname, MACHINE_PATHS)) return NextResponse.next();

  const blocked = passwordGate(request);
  if (blocked) return blocked;

  if (matches(pathname, PUBLIC_PATHS)) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
