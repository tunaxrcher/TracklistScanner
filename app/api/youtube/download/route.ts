import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { mkdirSync, rmSync, createReadStream } from "fs";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { searchYoutube } from "@/lib/server/ytdlp";
import { youtubeToFile } from "@/lib/server/djdl/convert";
import { buildQuery } from "@/lib/server/djpool/matcher";
import { TEMP_ROOT } from "@/lib/server/paths";
import { toUserMessage } from "@/lib/errors";
import type { DjDownloadFormat } from "@/lib/types";

export const runtime = "nodejs";

const MIME: Record<DjDownloadFormat, string> = { wav: "audio/wav", mp3: "audio/mpeg" };

/**
 * Download one track from YouTube as a DJ-ready file (synchronous response).
 * Body: { url } for a specific video, or { title, artist } to auto-pick the
 * top search result. Optional { format: "wav" | "mp3" } (default mp3) and
 * { baseName } to control the saved filename.
 */
export async function POST(request: NextRequest) {
  const dir = path.join(TEMP_ROOT, `yt-${randomUUID()}`);
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // best effort
    }
  };

  try {
    const body = (await request.json()) as {
      url?: string;
      title?: string;
      artist?: string;
      format?: string;
      baseName?: string;
    };
    const format: DjDownloadFormat = body.format === "wav" ? "wav" : "mp3";

    let url = String(body.url ?? "").trim();
    const title = String(body.title ?? "").trim();
    const artist = String(body.artist ?? "").trim();
    if (!url) {
      const query = buildQuery(title, artist);
      if (!query) return NextResponse.json({ error: "Empty query." }, { status: 400 });
      const results = await searchYoutube(query, 1, { signal: request.signal });
      if (results.length === 0) return NextResponse.json({ error: "notfound" }, { status: 404 });
      url = results[0].url;
    }

    mkdirSync(dir, { recursive: true });
    const result = await youtubeToFile({
      url,
      format,
      workDir: dir,
      outDir: dir,
      baseName: body.baseName || (title ? `${artist ? `${artist} - ` : ""}${title}` : undefined),
      signal: request.signal,
    });

    const nodeStream = createReadStream(result.filePath);
    nodeStream.on("close", cleanup);
    const stream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(stream, {
      headers: {
        "Content-Type": MIME[format],
        "Content-Length": String(result.fileSize),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    cleanup();
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[POST /api/youtube/download]", err);
    return NextResponse.json({ error: toUserMessage(err) }, { status: 500 });
  }
}
