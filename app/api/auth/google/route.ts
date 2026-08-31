import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/auth/origin";
import { googleAuthUrl, isGoogleConfigured } from "@/lib/auth/google";

export const runtime = "nodejs";

/** Kick off the Google sign-in flow. */
export function GET(request: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(appUrl(request, "/login?error=config"));
  }
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(googleAuthUrl(request, state));
  // Short-lived CSRF token checked by the callback.
  res.cookies.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
