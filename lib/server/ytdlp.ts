import { readdirSync } from "fs";
import path from "path";
import type { ChildProcess } from "child_process";
import { resolveYtDlp, resolveFfmpeg } from "@/lib/server/bin";
import { run } from "@/lib/server/proc";
import { AppError, classifyYtDlpError } from "@/lib/errors";
import type { DownloadFormat, MediaInfo } from "@/lib/types";

export interface YtDlpContext {
  signal?: AbortSignal;
  onSpawn?: (proc: ChildProcess) => void;
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
    ["--no-playlist", "--no-warnings", "-J", "--", url],
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

function buildFormatArgs(format: DownloadFormat, mp3Quality: number): string[] {
  switch (format) {
    case "mp3":
      return [
        "-f", "bestaudio/best",
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", `${mp3Quality}K`,
        "--embed-metadata",
        "--embed-thumbnail",
        "--convert-thumbnails", "jpg",
      ];
    case "m4a":
      return [
        "-f", "bestaudio[ext=m4a]/bestaudio/best",
        "-x",
        "--audio-format", "m4a",
        "--embed-metadata",
        "--embed-thumbnail",
        "--convert-thumbnails", "jpg",
      ];
    case "wav":
      return ["-f", "bestaudio/best", "-x", "--audio-format", "wav"];
    case "original":
      // Best audio stream, kept in its original codec/container. No re-encode.
      return ["-f", "bestaudio/best"];
  }
}

/**
 * Download audio into `outDir` with progress callbacks.
 * Returns the absolute path of the resulting file.
 */
export async function downloadAudio(
  url: string,
  format: DownloadFormat,
  outDir: string,
  mp3Quality: number,
  onProgress: (e: DownloadProgressEvent) => void,
  ctx: YtDlpContext = {},
): Promise<string> {
  const ytdlp = resolveYtDlp();
  const ffmpeg = resolveFfmpeg();

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--progress",
    "--ffmpeg-location", ffmpeg,
    "-o", path.join(outDir, "%(title).150B [%(id)s].%(ext)s"),
    ...buildFormatArgs(format, mp3Quality),
    "--", url,
  ];

  const handleLine = (line: string) => {
    const progress = parseProgressLine(line);
    if (progress) {
      onProgress(progress);
      return;
    }
    if (line.includes("[ExtractAudio]")) onProgress({ statusText: "Converting audio…" });
    else if (line.includes("[EmbedThumbnail]")) onProgress({ statusText: "Embedding cover…" });
    else if (line.includes("[Metadata]")) onProgress({ statusText: "Writing metadata…" });
    else if (line.includes("[download] Destination")) onProgress({ statusText: "Downloading…" });
  };

  const { code, stderr } = await run(ytdlp, args, {
    signal: ctx.signal,
    onSpawn: ctx.onSpawn,
    onStdoutLine: handleLine,
    onStderrLine: handleLine,
  });
  if (code !== 0) {
    console.warn("[yt-dlp download]", stderr.slice(0, 800));
    throw classifyYtDlpError(stderr);
  }

  // Locate the final output file (largest file in outDir, ignoring temp parts).
  const files = readdirSync(outDir).filter(
    (f) => !f.endsWith(".part") && !f.endsWith(".ytdl") && !f.endsWith(".jpg") && !f.endsWith(".webp"),
  );
  if (files.length === 0) throw new AppError("UNKNOWN", "Download finished but no file was produced.");
  files.sort((a, b) => a.localeCompare(b));
  return path.join(outDir, files[0]);
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
