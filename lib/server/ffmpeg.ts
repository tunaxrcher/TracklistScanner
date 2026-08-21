import path from "path";
import { resolveFfmpeg, resolveFfprobe } from "@/lib/server/bin";
import { run } from "@/lib/server/proc";
import { AppError } from "@/lib/errors";
import type { ChildProcess } from "child_process";

export interface FfmpegContext {
  signal?: AbortSignal;
  onSpawn?: (proc: ChildProcess) => void;
}

/** Duration of a media file in seconds, via ffprobe. */
export async function getDuration(filePath: string, ctx: FfmpegContext = {}): Promise<number> {
  const ffprobe = resolveFfprobe();
  const { code, stdout, stderr } = await run(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { signal: ctx.signal, onSpawn: ctx.onSpawn },
  );
  if (code !== 0) {
    console.warn("[ffprobe]", stderr.slice(0, 500));
    throw new AppError("CORRUPTED_AUDIO");
  }
  const duration = parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new AppError("CORRUPTED_AUDIO");
  return duration;
}

/**
 * Extract a mono 16 kHz 16-bit WAV sample — the format expected by both the
 * Shazam signature generator and ACRCloud.
 */
export async function extractSampleWav(
  input: string,
  startSec: number,
  durationSec: number,
  outPath: string,
  ctx: FfmpegContext = {},
): Promise<string> {
  const ffmpeg = resolveFfmpeg();
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-ss", startSec.toFixed(2),
    "-t", durationSec.toFixed(2),
    "-i", input,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "pcm_s16le",
    "-y",
    outPath,
  ];
  const { code, stderr } = await run(ffmpeg, args, { signal: ctx.signal, onSpawn: ctx.onSpawn });
  if (code !== 0) {
    console.warn("[ffmpeg sample]", stderr.slice(0, 500));
    if (/no space left|disk full/i.test(stderr)) throw new AppError("DISK_FULL");
    if (/permission denied/i.test(stderr)) throw new AppError("PERMISSION_DENIED");
    if (/invalid data|could not find codec|unknown format/i.test(stderr))
      throw new AppError("CORRUPTED_AUDIO");
    throw new AppError("FFMPEG_ERROR");
  }
  return path.resolve(outPath);
}
