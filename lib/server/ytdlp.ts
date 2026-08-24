import { existsSync, readdirSync } from "fs";
import path from "path";
import type { ChildProcess } from "child_process";
import { resolveYtDlp } from "@/lib/server/bin";
import { run } from "@/lib/server/proc";
import { AppError, classifyYtDlpError } from "@/lib/errors";
import type { MediaInfo } from "@/lib/types";

export interface YtDlpContext {
  signal?: AbortSignal;
  onSpawn?: (proc: ChildProcess) => void;
}

/**
 * Args shared by every yt-dlp call. YTDLP_COOKIES points to a Netscape-format
 * cookies.txt — needed on datacenter IPs where YouTube demands a signed-in
 * session ("Sign in to confirm you're not a bot").
 */
function commonArgs(): string[] {
  const cookies = process.env.YTDLP_COOKIES;
  if (cookies && existsSync(cookies)) return ["--cookies", cookies];
  return [];
}

export interface DownloadProgressEvent {
  percent?: number;
  speed?: string;
  eta?: string;
  statusText?: string;
}

/** Fetch title / duration / thumbnail without downloading anything. */
export async function fetchMediaInfo(url: string, ctx: YtDlpContext = {}): Promise<MediaInfo> {
  const ytdlp = resolveYtDlp();
  const { code, stdout, stderr } = await run(
    ytdlp,
    ["--no-playlist", "--no-warnings", ...commonArgs(), "-J", "--", url],
    { signal: ctx.signal, onSpawn: ctx.onSpawn },
  );
  if (code !== 0) {
    console.warn("[yt-dlp info]", stderr.slice(0, 800));
    throw classifyYtDlpError(stderr);
  }
  try {
    const data = JSON.parse(stdout) as {
      title?: string;
      thumbnail?: string;
      duration?: number;
      uploader?: string;
      channel?: string;
    };
    return {
      title: data.title,
      thumbnail: data.thumbnail,
      duration: data.duration,
      uploader: data.uploader ?? data.channel,
    };
  } catch {
    throw new AppError("UNKNOWN", "Could not read media information from this URL.");
  }
}

// Example: "[download]  43.2% of ~  5.34MiB at    1.23MiB/s ETA 00:03"
const PROGRESS_RE =
  /\[download\]\s+(\d+(?:\.\d+)?)%(?:\s+of\s+~?\s*\S+)?(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/;

function parseProgressLine(line: string): DownloadProgressEvent | null {
  const m = PROGRESS_RE.exec(line);
  if (!m) return null;
  return {
    percent: parseFloat(m[1]),
    speed: m[2] && m[2] !== "Unknown" ? m[2] : undefined,
    eta: m[3] && m[3] !== "Unknown" ? m[3] : undefined,
  };
}

/**
 * Fetch best audio into a temp file for scanning (no re-encode, no metadata).
 * Used by the URL tracklist scanner — this is a temporary artifact, not a
 * user-facing download, and is cleaned up when the job ends.
 */
export async function fetchAudioForScan(
  url: string,
  outDir: string,
  onProgress: (e: DownloadProgressEvent) => void,
  ctx: YtDlpContext = {},
): Promise<string> {
  const ytdlp = resolveYtDlp();
  const args = [
    "--no-playlist",
    "--no-warnings",
    ...commonArgs(),
    "--newline",
    "--progress",
    "-f", "bestaudio/best",
    "-o", path.join(outDir, "source.%(ext)s"),
    "--", url,
  ];
  const { code, stderr } = await run(ytdlp, args, {
    signal: ctx.signal,
    onSpawn: ctx.onSpawn,
    onStdoutLine: (line) => {
      const progress = parseProgressLine(line);
      if (progress) onProgress(progress);
    },
  });
  if (code !== 0) {
    console.warn("[yt-dlp scan-fetch]", stderr.slice(0, 800));
    throw classifyYtDlpError(stderr);
  }
  const file = readdirSync(outDir).find((f) => f.startsWith("source.") && !f.endsWith(".part"));
  if (!file) throw new AppError("UNKNOWN", "Could not prepare audio for scanning.");
  return path.join(outDir, file);
}
