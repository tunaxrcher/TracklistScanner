import { randomUUID } from "crypto";
import { unlink } from "fs/promises";
import type { AudioSource, AudioSourceContext } from "@/lib/server/audio/AudioSource";
import { recognizeSample } from "@/lib/server/recognition/engine";
import { createStrategy, type SampleOutcome } from "./sampling";
import { shouldMerge, trackKey } from "@/lib/tracklist";
import type { ScanSettings, TrackEntry } from "@/lib/types";

export interface ScanCallbacks {
  /** Progress inside the current source. */
  onProgress(update: {
    currentTimestamp: number;
    totalDuration: number;
    samplesScanned: number;
    totalSamples: number;
    fileProgress: number;
    recognizing: boolean;
    samplesFailed: number;
  }): void;
  /** A brand new track entry was added. */
  onTrack(track: TrackEntry): void;
  /** An existing entry's lastSeen was extended (same song still playing). */
  onTrackUpdated(track: TrackEntry): void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Pacing between recognition requests. A small base delay keeps request
// bursts down; the cooldown grows while Shazam is rate-limiting and resets
// as soon as a sample gets a reliable answer again.
const BASE_DELAY_MS = 800;
const COOLDOWN_START_MS = 10_000;
const COOLDOWN_MAX_MS = 60_000;

/**
 * The single Scanner used by every source type (URL / file / folder).
 * Walks the audio with a sampling strategy, sends each sample through the
 * central recognition engine, and live-merges consecutive duplicates.
 */
export async function scanAudioSource(
  source: AudioSource,
  fileIndex: number,
  settings: ScanSettings,
  ctx: AudioSourceContext,
  callbacks: ScanCallbacks,
): Promise<{ tracks: TrackEntry[]; samplesFailed: number }> {
  const duration = await source.getDuration();
  const strategy = createStrategy(settings.smartScan, settings.scanInterval);
  const totalSamples = strategy.estimateTotal(duration);

  const tracks: TrackEntry[] = [];
  let position: number | null = strategy.first(duration);
  let samplesScanned = 0;
  let samplesFailed = 0;
  let lastKey: string | null = null;
  let sameStreak = 0;
  let cooldownMs = 0;

  while (position !== null && position < duration) {
    if (ctx.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const sampleDuration = Math.min(settings.sampleDuration, duration - position);
    callbacks.onProgress({
      currentTimestamp: position,
      totalDuration: duration,
      samplesScanned,
      totalSamples,
      fileProgress: Math.min(99, (position / duration) * 100),
      recognizing: true,
      samplesFailed,
    });

    let outcome: SampleOutcome = "no-match";
    const wavPath = await source.getSample(position, sampleDuration, ctx);
    try {
      const { result, degraded } = await recognizeSample(wavPath, settings, ctx.signal);
      if (ctx.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      if (result) {
        cooldownMs = 0;
        const key = trackKey(result.title, result.artist);
        outcome = key === lastKey ? "same-song" : "new-song";
        lastKey = key;

        const prev = tracks[tracks.length - 1];
        if (shouldMerge(prev, result.title, result.artist, position, fileIndex, settings.mergeWindow)) {
          prev.lastSeen = position;
          callbacks.onTrackUpdated(prev);
        } else {
          const track: TrackEntry = {
            id: randomUUID(),
            timestamp: position,
            lastSeen: position,
            title: result.title,
            artist: result.artist,
            album: result.album,
            coverUrl: result.coverUrl,
            provider: result.provider,
            file: source.displayName,
            fileIndex,
          };
          tracks.push(track);
          callbacks.onTrack(track);
        }
      } else if (degraded) {
        // Could not get a reliable answer (rate limit / provider errors):
        // count it and back off, but keep lastKey so a song still playing
        // is not artificially split into two entries.
        samplesFailed += 1;
        cooldownMs = Math.min(COOLDOWN_MAX_MS, cooldownMs === 0 ? COOLDOWN_START_MS : cooldownMs * 2);
      } else {
        cooldownMs = 0;
        lastKey = null;
      }
    } finally {
      unlink(wavPath).catch(() => {});
    }

    sameStreak = outcome === "same-song" ? sameStreak + 1 : 0;
    samplesScanned += 1;
    callbacks.onProgress({
      currentTimestamp: position,
      totalDuration: duration,
      samplesScanned,
      totalSamples,
      fileProgress: Math.min(99, ((position + settings.scanInterval) / duration) * 100),
      recognizing: false,
      samplesFailed,
    });

    position = strategy.next(position, duration, outcome, sameStreak);
    if (position !== null && position < duration) {
      await sleep(BASE_DELAY_MS + cooldownMs, ctx.signal);
    }
  }

  callbacks.onProgress({
    currentTimestamp: duration,
    totalDuration: duration,
    samplesScanned,
    totalSamples: samplesScanned,
    fileProgress: 100,
    recognizing: false,
    samplesFailed,
  });

  return { tracks, samplesFailed };
}
