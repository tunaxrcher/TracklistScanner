import { NextRequest } from "next/server";
import {
  openPoolFile,
  isDjPoolConfigured,
  isPoolUrl,
  filenameFromDisposition,
} from "@/lib/server/djpool/client";
import { findCandidates } from "@/lib/server/djpool/matcher";
import { AppError, toUserMessage } from "@/lib/errors";
import { DEFAULT_DJPOOL_PREFERENCES, type DjPoolPreferences } from "@/lib/types";

export const runtime = "nodejs";

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180);
}

/**
 * Download a single track directly (streamed back to the browser). Either pass
 * a specific `downloadUrl` (from /api/djpool/search) or a `title`/`artist` pair
 * to auto-pick the best match.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isDjPoolConfigured()) throw new AppError("DJPOOL_NOT_CONFIGURED");

    const body = (await request.json()) as {
      title?: string;
      artist?: string;
      downloadUrl?: string;
      name?: string;
      preferences?: Partial<DjPoolPreferences>;
    };

    let url = String(body.downloadUrl ?? "").trim();
    let fallbackName = String(body.name ?? "").trim();

    if (!url) {
      const title = String(body.title ?? "").trim();
      const artist = String(body.artist ?? "").trim();
      if (!title) return jsonError("Empty query.", 400);

      const prefs: DjPoolPreferences = { ...DEFAULT_DJPOOL_PREFERENCES, ...body.preferences };
      const { candidates, matched } = await findCandidates(title, artist, prefs);
      if (!matched) return jsonError("notfound", 404);

      const best = candidates[0];
      url = best.download;
      fallbackName = best.name.endsWith(`.${best.ext}`) ? best.name : `${best.name}.${best.ext}`;
    }

    if (!isPoolUrl(url)) return jsonError("Invalid download URL.", 400);

    const upstream = await openPoolFile(url, request.signal);
    const serverName =
      filenameFromDisposition(upstream.headers.get("content-disposition") ?? "") || fallbackName || "track.mp3";
    const fileName = sanitize(serverName);
    const contentType = upstream.headers.get("content-type") ?? "audio/mpeg";
    const length = upstream.headers.get("content-length");

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
      // Tell nginx not to buffer: the browser needs bytes as they arrive (seek/preview).
      "X-Accel-Buffering": "no",
    };
    if (length) headers["Content-Length"] = length;

    return new Response(upstream.body, { headers });
  } catch (err) {
    console.error("[POST /api/djpool/download]", err);
    const status = err instanceof AppError && err.code === "DJPOOL_NOT_CONFIGURED" ? 400 : 500;
    return jsonError(toUserMessage(err), status);
  }
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
