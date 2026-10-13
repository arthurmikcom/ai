import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth"];

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
    headers: { "WWW-Authenticate": 'Basic realm="Nexus AI", charset="UTF-8"' },
  });
}

/**
 * Sends visitors without a session to the login page. This only looks at the
 * cookie (fast); every API route still verifies the session itself.
 */
export function proxy(request: NextRequest) {
  const blocked = passwordGate(request);
  if (blocked) return blocked;

  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
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
