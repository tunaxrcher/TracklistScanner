// Session tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
// Uses only Web Crypto so the same code runs in the proxy (edge) and in
// Node route handlers.

export const SESSION_COOKIE = "tls_session";
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

export interface SessionData {
  email: string;
  name?: string;
  picture?: string;
  /** Unix seconds. */
  exp: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * The signing secret. AUTH_SECRET should be set in production; without it an
 * ephemeral secret is generated, which invalidates sessions on every restart.
 */
let ephemeral: string | undefined;
export function authSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (!ephemeral) {
    ephemeral = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    console.warn("[auth] AUTH_SECRET is not set — using an ephemeral secret (sessions reset on restart).");
  }
  return ephemeral;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(data: SessionData, secret: string): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify(data));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), payload);
  return `${b64urlEncode(payload)}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionData | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  try {
    const payload = b64urlDecode(token.slice(0, dot));
    const sig = b64urlDecode(token.slice(dot + 1));
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      sig as unknown as ArrayBuffer,
      payload as unknown as ArrayBuffer,
    );
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(payload)) as SessionData;
    if (typeof data.email !== "string" || typeof data.exp !== "number") return null;
    if (data.exp * 1000 < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Explicit opt-in to run without sign-in (local single-user dev). Everyone
 * then shares one pseudo-account, so this must never be the default: a
 * production box that merely forgot its Google credentials would otherwise
 * expose every user's jobs and history to every visitor.
 */
export function isOpenMode(): boolean {
  return process.env.AUTH_OPEN_MODE === "true" && !isGoogleConfigured();
}

/**
 * Resolve the signed-in user's email from a request's session cookie.
 * In open mode requests have no session and map to a shared pseudo-user.
 */
export async function sessionEmail(request: {
  cookies: { get(name: string): { value: string } | undefined };
}): Promise<string | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token, authSecret()) : null;
  if (session) return session.email;
  return isOpenMode() ? "anonymous@local" : null;
}

/** Emails allowed to sign in (comma-separated env). Empty = anyone with a Google account. */
export function isEmailAllowed(email: string): boolean {
  const raw = process.env.ALLOWED_EMAILS ?? "";
  const list = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true;
  return list.includes(email.toLowerCase());
}
