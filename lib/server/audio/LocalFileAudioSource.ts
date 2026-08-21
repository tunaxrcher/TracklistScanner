import path from "path";
import { randomUUID } from "crypto";
import type { AudioSource, AudioSourceContext } from "./AudioSource";
import { extractSampleWav, getDuration } from "@/lib/server/ffmpeg";

/** A single audio file on disk. Folder scans use many of these. */
export class LocalFileAudioSource implements AudioSource {
  private duration?: number;

  constructor(
    private readonly filePath: string,
    public readonly displayName: string,
    private readonly sampleDir: string,
  ) {}

  async prepare(ctx: AudioSourceContext): Promise<void> {
    this.duration = await getDuration(this.filePath, ctx);
  }

  async getDuration(): Promise<number> {
    if (this.duration == null) throw new Error("prepare() must be called first");
    return this.duration;
  }

  async getSample(startTime: number, duration: number, ctx: AudioSourceContext): Promise<string> {
    const out = path.join(this.sampleDir, `sample-${randomUUID()}.wav`);
    return extractSampleWav(this.filePath, startTime, duration, out, ctx);
  }
}
