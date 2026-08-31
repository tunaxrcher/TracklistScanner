import type { NextRequest } from "next/server";
import { appOrigin } from "@/lib/auth/origin";

export { appOrigin };

// Google OAuth 2.0 endpoints (authorization code flow).
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(request: NextRequest): string {
  return `${appOrigin(request)}/api/auth/callback`;
}

export function googleAuthUrl(request: NextRequest, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${AUTH_URL}?${params}`;
}

export interface GoogleProfile {
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/** Exchange the authorization code for tokens and read the profile from the id_token. */
export async function exchangeCode(request: NextRequest, code: string): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(request),
    }),
  });
  if (!res.ok) {
    console.error("[auth] token exchange failed:", res.status, await res.text().catch(() => ""));
    throw new Error("Token exchange failed.");
  }
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error("No id_token in Google response.");

  // The id_token comes straight from Google over TLS, so decoding the payload
  // without signature verification is safe here.
  const payloadB64 = data.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8")) as {
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!payload.email) throw new Error("Google account has no email.");
  return {
    email: payload.email,
    emailVerified: payload.email_verified ?? false,
    name: payload.name,
    picture: payload.picture,
  };
}
