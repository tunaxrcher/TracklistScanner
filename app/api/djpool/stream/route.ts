import { NextRequest } from "next/server";
import { isDjPoolConfigured, isPoolUrl, openPoolFile } from "@/lib/server/djpool/client";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * Stream a DJ Pool file inline for in-browser playback (<audio src>).
 * `u` must be a djpoolrecords.com stream/download URL from /api/djpool/search.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isDjPoolConfigured()) return jsonError("DJ Pool is not configured.", 400);
    const url = request.nextUrl.searchParams.get("u") ?? "";
    if (!isPoolUrl(url)) return jsonError("Invalid stream URL.", 400);

    const range = request.headers.get("range") ?? undefined;
    const upstream = await openPoolFile(url, request.signal, range);
    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store",
    };
    // Pass range metadata through so the <audio> element can seek freely.
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) headers[h] = v;
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    console.error("[GET /api/djpool/stream]", err);
    return jsonError(toUserMessage(err), 500);
  }
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
