import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { AppError } from "@/lib/errors";

const BASE = "https://djpoolrecords.com";
const LOGIN_URL = `${BASE}/djpoolrecords-user-login/`;
const FILES_REST = `${BASE}/wp-json/dpr-search/v1/files`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Raw file record returned by the pool search index. */
export interface PoolFile {
  name: string;
  ext: string;
  size: string;
  mime: string;
  download: string;
  stream?: string;
}

interface Session {
  cookies: Map<string, string>;
  /** WP REST nonce required by the members-only search endpoint. */
  nonce: string;
  createdAt: number;
}

export function isDjPoolConfigured(): boolean {
  return Boolean(process.env.DJPOOL_EMAIL && process.env.DJPOOL_PASSWORD);
}

// A live session is cached across requests (survives dev reloads).
const store = globalThis as unknown as { __djpoolSession?: Session | null; __djpoolLogin?: Promise<Session> | null };

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(cookies: Map<string, string>, res: Response): void {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === "" || /^deleted$/i.test(value)) cookies.delete(name);
    else cookies.set(name, value);
  }
}

async function performLogin(): Promise<Session> {
  const email = process.env.DJPOOL_EMAIL;
  const password = process.env.DJPOOL_PASSWORD;
  if (!email || !password) throw new AppError("DJPOOL_NOT_CONFIGURED");

  const cookies = new Map<string, string>();

  let loginPage: Response;
  try {
    loginPage = await fetch(LOGIN_URL, { headers: { "User-Agent": UA }, redirect: "manual" });
  } catch {
    throw new AppError("DJPOOL_UNAVAILABLE");
  }
  storeCookies(cookies, loginPage);
  const pageHtml = await loginPage.text();

  // Carry over any hidden fields the login form ships with (hCaptcha signatures,
  // redirect_to, testcookie). Missing these can trigger a soft rejection.
  const hidden: Record<string, string> = {};
  for (const m of pageHtml.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const name = m[0].match(/name="([^"]+)"/)?.[1];
    const value = m[0].match(/value="([^"]*)"/)?.[1];
    if (name) hidden[name] = value ?? "";
  }

  cookies.set("wordpress_test_cookie", "WP+Cookie+check");
  const body = new URLSearchParams({
    ...hidden,
    log: email,
    pwd: password,
    rememberme: "forever",
    "wp-submit": "Log In",
    testcookie: "1",
  });

  let res: Response;
  try {
    res = await fetch(LOGIN_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader(cookies),
        Referer: LOGIN_URL,
        Origin: BASE,
      },
      body: body.toString(),
    });
  } catch {
    throw new AppError("DJPOOL_UNAVAILABLE");
  }
  storeCookies(cookies, res);

  const loggedIn = [...cookies.keys()].some((k) => k.startsWith("wordpress_logged_in"));
  if (!loggedIn) throw new AppError("DJPOOL_LOGIN_FAILED");

  const nonce = await fetchNonce(cookies);
  return { cookies, nonce, createdAt: Date.now() };
}

/** The dpr-search nonce is embedded in the `dprMeili` inline config on any page. */
async function fetchNonce(cookies: Map<string, string>): Promise<string> {
  const res = await fetch(`${BASE}/`, {
    headers: { "User-Agent": UA, Cookie: cookieHeader(cookies) },
    redirect: "manual",
  });
  storeCookies(cookies, res);
  const html = await res.text();
  const nonce = html.match(/"nonce":"([a-f0-9]+)"/)?.[1];
  if (!nonce) throw new AppError("DJPOOL_UNAVAILABLE");
  return nonce;
}

/** Get a valid session, logging in (and de-duping concurrent logins) as needed. */
async function getSession(forceRefresh = false): Promise<Session> {
  if (!forceRefresh && store.__djpoolSession) {
    // Sessions are good for hours; refresh proactively after ~45 min.
    if (Date.now() - store.__djpoolSession.createdAt < 45 * 60 * 1000) {
      return store.__djpoolSession;
    }
  }
  if (store.__djpoolLogin) return store.__djpoolLogin;

  store.__djpoolLogin = performLogin()
    .then((session) => {
      store.__djpoolSession = session;
      return session;
    })
    .finally(() => {
      store.__djpoolLogin = null;
    });
  return store.__djpoolLogin;
}

interface FilesResponse {
  hits?: PoolFile[];
  estimatedTotalHits?: number;
  error?: string;
}

async function requestFiles(session: Session, query: string, limit: number, offset: number): Promise<FilesResponse> {
  const url = `${FILES_REST}?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      "X-WP-Nonce": session.nonce,
      Cookie: cookieHeader(session.cookies),
      Referer: `${BASE}/`,
    },
    redirect: "manual",
  });
  storeCookies(session.cookies, res);
  if (res.status === 401 || res.status === 403) return { error: "unauthorized" };
  try {
    return (await res.json()) as FilesResponse;
  } catch {
    return { error: "bad_response" };
  }
}

/**
 * Search the members-only file index. Automatically re-authenticates once if
 * the session/nonce has expired.
 */
export async function searchPoolFiles(query: string, limit = 40, offset = 0): Promise<PoolFile[]> {
  if (!isDjPoolConfigured()) throw new AppError("DJPOOL_NOT_CONFIGURED");
  let session = await getSession();
  let data = await requestFiles(session, query, limit, offset);

  // members_only / unauthorized => stale nonce or session; refresh once.
  if (data.error === "members_only" || data.error === "unauthorized" || data.error === "rest_cookie_invalid_nonce") {
    session = await getSession(true);
    data = await requestFiles(session, query, limit, offset);
  }
  if (data.error && data.error !== "members_only") {
    // Any remaining error after a refresh: surface as unavailable rather than throwing per-track.
    if (data.error === "unauthorized") throw new AppError("DJPOOL_LOGIN_FAILED");
  }
  return data.hits ?? [];
}

/** Parse a filename out of a Content-Disposition header. */
export function filenameFromDisposition(disposition: string): string | undefined {
  return (
    decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? "") ||
    disposition.match(/filename="([^"]+)"/i)?.[1] ||
    undefined
  );
}

/**
 * Open a pool file for streaming using the authenticated session. Returns the
 * raw fetch Response so callers can pipe it straight to an HTTP response.
 */
export async function openPoolFile(url: string, signal?: AbortSignal, range?: string): Promise<Response> {
  const session = await getSession();
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Cookie: cookieHeader(session.cookies),
    Referer: `${BASE}/`,
  };
  // Forward Range so <audio> seeking works when the pool's server supports it.
  if (range) headers.Range = range;
  const res = await fetch(url, {
    headers,
    redirect: "follow",
    signal,
  });
  if (!res.ok || !res.body) {
    throw new AppError("DJPOOL_UNAVAILABLE", `Download failed (HTTP ${res.status}).`);
  }
  return res;
}

/** Only allow download URLs that belong to the pool (guards against SSRF). */
export function isPoolUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "djpoolrecords.com";
  } catch {
    return false;
  }
}

/**
 * Stream a pool file to disk using the authenticated session. Returns the
 * server-provided filename when present.
 */
export async function downloadPoolFile(
  url: string,
  destPath: string,
  signal?: AbortSignal,
): Promise<{ bytes: number; serverName?: string }> {
  const res = await openPoolFile(url, signal);
  const serverName = filenameFromDisposition(res.headers.get("content-disposition") ?? "");
  const lengthHeader = Number(res.headers.get("content-length") ?? 0);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(destPath));
  return { bytes: lengthHeader, serverName };
}
