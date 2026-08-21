import type { AudioSource, AudioSourceContext } from "./AudioSource";
import { LocalFileAudioSource } from "./LocalFileAudioSource";
import { fetchAudioForScan, fetchMediaInfo } from "@/lib/server/ytdlp";
import type { MediaInfo } from "@/lib/types";

/**
 * URL source (YouTube or anything yt-dlp supports).
 *
 * prepare() pulls the best audio stream into the job temp dir once (original
 * codec, no re-encode, never a user-facing MP3) and then sampling happens
 * locally. The temp audio is removed automatically when the job finishes.
 */
export class YouTubeAudioSource implements AudioSource {
  readonly displayName = "Online Source";
  info?: MediaInfo;
  private local?: LocalFileAudioSource;

  constructor(
    private readonly url: string,
    private readonly tempDir: string,
  ) {}

  async prepare(ctx: AudioSourceContext): Promise<void> {
    ctx.onPrepareProgress?.(0, "Checking URL…");
    this.info = await fetchMediaInfo(this.url, ctx);
    ctx.onPrepareProgress?.(2, "Fetching audio stream…");
    const audioPath = await fetchAudioForScan(
      this.url,
      this.tempDir,
      (e) => {
        if (e.percent != null) ctx.onPrepareProgress?.(e.percent, "Fetching audio stream…");
      },
      ctx,
    );
    this.local = new LocalFileAudioSource(audioPath, this.displayName, this.tempDir);
    await this.local.prepare(ctx);
    ctx.onPrepareProgress?.(100, "Audio ready");
  }

  async getDuration(): Promise<number> {
    if (!this.local) throw new Error("prepare() must be called first");
    return this.local.getDuration();
  }

  async getSample(startTime: number, duration: number, ctx: AudioSourceContext): Promise<string> {
    if (!this.local) throw new Error("prepare() must be called first");
    return this.local.getSample(startTime, duration, ctx);
  }
}
