import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { Readable } from "stream";
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
 * Stream a YouTube video's audio inline for in-browser preview (<audio src>).
 * yt-dlp pipes the best audio stream straight to the response — nothing is
 * written to disk. Prefers webm/opus, which every Chromium/Firefox plays.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("u") ?? "";
  if (!isYoutubeUrl(url)) {
    return new Response(JSON.stringify({ error: "Invalid YouTube URL." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const proc = spawn(
    resolveYtDlp(),
    [
      "--no-playlist",
      "--no-warnings",
      ...ytdlpCommonArgs(),
      "-f",
      "bestaudio[ext=webm]/bestaudio",
      "-o",
      "-",
      "--",
      url,
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );

  let stderr = "";
  proc.stderr.on("data", (d: Buffer) => {
    if (stderr.length < 2000) stderr += d.toString();
  });

  const kill = () => {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  };
  request.signal.addEventListener("abort", kill);

  // Wait for the first chunk so hard failures (age wall, bot check) become a
  // clean 502 instead of an empty 200 stream.
  const started = await new Promise<boolean>((resolve) => {
    proc.stdout.once("readable", () => resolve(true));
    proc.once("exit", (code) => resolve(code === 0));
    proc.once("error", () => resolve(false));
  });
  if (!started) {
    console.warn("[GET /api/youtube/stream]", stderr.slice(0, 500));
    return new Response(JSON.stringify({ error: "Preview unavailable for this video." }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = Readable.toWeb(proc.stdout) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "audio/webm",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store",
    },
  });
}
