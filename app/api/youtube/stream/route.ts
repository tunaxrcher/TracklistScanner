import { NextRequest } from "next/server";
import { run } from "@/lib/server/proc";
import { resolveYtDlp } from "@/lib/server/bin";
import { ytdlpCommonArgs } from "@/lib/server/ytdlp";

export const runtime = "nodejs";

function isYoutubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com"))
    );
  } catch {
    return false;
  }
}

/**
 * Direct googlevideo audio URLs resolved by yt-dlp. They stay valid for hours;
 * a short cache makes repeated plays and every seek instant.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;
const directUrlCache = new Map<string, { url: string; at: number }>();

async function resolveDirectAudioUrl(videoUrl: string, signal?: AbortSignal): Promise<string> {
  const hit = directUrlCache.get(videoUrl);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.url;

  const { code, stdout, stderr } = await run(
    resolveYtDlp(),
    [
      "--no-playlist",
      "--no-warnings",
      ...ytdlpCommonArgs(),
      "-g",
      "-f",
      "bestaudio[ext=webm]/bestaudio",
      "--",
      videoUrl,
    ],
    { signal },
  );
  const url = stdout.trim().split(/\r?\n/)[0];
  if (code !== 0 || !url) {
    console.warn("[youtube/stream resolve]", stderr.slice(0, 500));
    throw new Error("Could not resolve an audio stream for this video.");
  }
  // Sweep expired entries so the cache can't grow forever on a long-running server.
  for (const [key, entry] of directUrlCache) {
    if (Date.now() - entry.at >= CACHE_TTL_MS) directUrlCache.delete(key);
  }
  directUrlCache.set(videoUrl, { url, at: Date.now() });
  return url;
}

/**
 * Stream a YouTube video's audio inline for in-browser preview (<audio src>).
 * yt-dlp only resolves the direct audio URL; the actual bytes are proxied with
 * full HTTP Range support so the player can seek anywhere.
 */
export async function GET(request: NextRequest) {
  const videoUrl = request.nextUrl.searchParams.get("u") ?? "";
  if (!isYoutubeUrl(videoUrl)) return jsonError("Invalid YouTube URL.", 400);

  try {
    const range = request.headers.get("range") ?? undefined;
    let upstream = await fetchUpstream(videoUrl, range, request.signal);

    // Direct URLs eventually expire (403) — re-resolve once and retry.
    if (upstream.status === 403 || upstream.status === 410) {
      directUrlCache.delete(videoUrl);
      upstream = await fetchUpstream(videoUrl, range, request.signal);
    }
    if (!upstream.ok && upstream.status !== 206) {
      console.warn("[youtube/stream] upstream status", upstream.status);
      return jsonError("Preview unavailable for this video.", 502);
    }

    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/webm",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store",
    };
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) headers[h] = v;
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[GET /api/youtube/stream]", err);
    return jsonError("Preview unavailable for this video.", 502);
  }
}

async function fetchUpstream(
  videoUrl: string,
  range: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const directUrl = await resolveDirectAudioUrl(videoUrl, signal);
  return fetch(directUrl, {
    headers: range ? { Range: range } : {},
    signal,
    redirect: "follow",
  });
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
