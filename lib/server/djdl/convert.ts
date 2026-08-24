import path from "path";
import { mkdirSync, statSync } from "fs";
import { resolveFfmpeg } from "@/lib/server/bin";
import { run } from "@/lib/server/proc";
import { AppError } from "@/lib/errors";
import { sanitizeFileName } from "@/lib/server/paths";
import {
  fetchAudioForScan,
  fetchMediaInfo,
  type YtDlpContext,
  type DownloadProgressEvent,
} from "@/lib/server/ytdlp";
import type { DjDownloadFormat, MediaInfo } from "@/lib/types";

export interface YoutubeToFileOptions extends YtDlpContext {
  /** Full video URL (or any yt-dlp source). */
  url: string;
  format: DjDownloadFormat;
  /** Where the raw source download goes (temp, cleaned up by the caller). */
  workDir: string;
  /** Where the finished file goes. */
  outDir: string;
  /** Final name without extension; defaults to the video title. */
  baseName?: string;
  /** Skip the info fetch when the caller already has it. */
  info?: MediaInfo;
  onDownloadProgress?: (e: DownloadProgressEvent) => void;
}

export interface YoutubeToFileResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  info: MediaInfo;
}

/**
 * YouTube URL → DJ-ready audio file.
 *
 * Fetches the best available audio stream (usually ~130-160 kbps Opus — the
 * highest quality YouTube serves), then converts it once:
 *   - wav: 44.1 kHz / 16-bit PCM — no further quality loss, plays on any CDJ
 *   - mp3: 320 kbps CBR with title/artist tags — small and universal
 */
export async function youtubeToFile(opts: YoutubeToFileOptions): Promise<YoutubeToFileResult> {
  const ctx: YtDlpContext = { signal: opts.signal, onSpawn: opts.onSpawn };
  mkdirSync(opts.workDir, { recursive: true });
  mkdirSync(opts.outDir, { recursive: true });
  const info = opts.info ?? (await fetchMediaInfo(opts.url, ctx));

  const source = await fetchAudioForScan(opts.url, opts.workDir, opts.onDownloadProgress ?? (() => {}), ctx);

  const base = sanitizeFileName(opts.baseName ?? info.title ?? "audio") || "audio";
  const fileName = `${base}.${opts.format}`;
  const outPath = path.join(opts.outDir, fileName);

  const ffmpeg = resolveFfmpeg();
  const args =
    opts.format === "wav"
      ? ["-y", "-i", source, "-vn", "-ar", "44100", "-sample_fmt", "s16", "-map_metadata", "-1", outPath]
      : [
          "-y", "-i", source, "-vn",
          "-codec:a", "libmp3lame", "-b:a", "320k", "-ar", "44100",
          "-id3v2_version", "3",
          ...(info.title ? ["-metadata", `title=${info.title}`] : []),
          ...(info.uploader ? ["-metadata", `artist=${info.uploader}`] : []),
          outPath,
        ];

  const { code, stderr } = await run(ffmpeg, args, ctx);
  if (code !== 0) {
    console.warn("[djdl ffmpeg]", stderr.slice(0, 800));
    throw new AppError("FFMPEG_ERROR");
  }

  return { filePath: outPath, fileName, fileSize: statSync(outPath).size, info };
}
