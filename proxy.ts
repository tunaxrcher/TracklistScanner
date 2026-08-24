import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, authSecret, verifySessionToken } from "@/lib/auth/session";

// Paths reachable without a session.
const PUBLIC_PREFIXES = ["/api/auth/", "/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Without Google credentials there is no way to sign in, so the gate would
  // lock everyone out — run open until GOOGLE_CLIENT_ID/SECRET are configured.
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token, authSecret()) : null;

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    // Already signed in → skip the login page.
    if (session && pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/|favicon\\.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico|mp3|woff2?)$).*)"],
};
