import type { NextRequest } from "next/server";

/**
 * Public URL the browser uses to reach us. APP_URL wins — required behind
 * nginx, where request.url looks like http://localhost:4000.
 */
export function appOrigin(request: NextRequest): string {
  const fromEnv = process.env.APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return new URL(request.url).origin;
}

/** Absolute URL on the public origin (path must start with "/"). */
export function appUrl(request: NextRequest, path: string): URL {
  return new URL(path, `${appOrigin(request)}/`);
}
