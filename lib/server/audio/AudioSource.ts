import type { ChildProcess } from "child_process";

export interface AudioSourceContext {
  signal?: AbortSignal;
  onSpawn?: (proc: ChildProcess) => void;
  /** Progress while the source prepares itself (e.g. URL fetching audio). 0-100 */
  onPrepareProgress?: (percent: number, statusText?: string) => void;
}

/**
 * Central abstraction: every scan source (URL, local file, folder entries)
 * exposes the same interface so a single Scanner implementation handles all.
 */
export interface AudioSource {
  /** Display name shown in the tracklist "File" column */
  readonly displayName: string;
  /** One-time setup (URL sources fetch their audio here). */
  prepare(ctx: AudioSourceContext): Promise<void>;
  /** Total duration in seconds. Only valid after prepare(). */
  getDuration(): Promise<number>;
  /**
   * Extract a sample as a mono 16 kHz WAV file and return its path.
   * The file lives inside the job temp dir and is deleted by the scanner.
   */
  getSample(startTime: number, duration: number, ctx: AudioSourceContext): Promise<string>;
}
