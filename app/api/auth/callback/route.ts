import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/auth/origin";
import { exchangeCode } from "@/lib/auth/google";
import { isDbConfigured } from "@/lib/server/db";
import { upsertUser } from "@/lib/server/recents";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  authSecret,
  createSessionToken,
  isEmailAllowed,
} from "@/lib/auth/session";

export const runtime = "nodejs";

function loginRedirect(request: NextRequest, error: string): NextResponse {
  const res = NextResponse.redirect(appUrl(request, `/login?error=${error}`));
  res.cookies.delete("oauth_state");
  return res;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("oauth_state")?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return loginRedirect(request, "state");
  }

  try {
    const profile = await exchangeCode(request, code);
    if (!profile.emailVerified) return loginRedirect(request, "unverified");
    if (!isEmailAllowed(profile.email)) return loginRedirect(request, "denied");

    // Record the account, but never block sign-in on a DB hiccup.
    if (isDbConfigured()) {
      await upsertUser(profile.email, profile.name, profile.picture).catch((err) =>
        console.error("[auth callback] user upsert failed:", err),
      );
    }

    const token = await createSessionToken(
      {
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC,
      },
      authSecret(),
    );

    const res = NextResponse.redirect(appUrl(request, "/"));
    res.cookies.delete("oauth_state");
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_MAX_AGE_SEC,
      path: "/",
    });
    return res;
  } catch (err) {
    console.error("[auth callback]", err);
    return loginRedirect(request, "failed");
  }
}
