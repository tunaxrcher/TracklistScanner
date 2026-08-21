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
// Capped at 30s: with in-sample retries a blocked stretch already costs
// ~1 min per sample; a 60s cap made long scans look frozen near the end.
const COOLDOWN_MAX_MS = 30_000;

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

      if (process.env.SCAN_DEBUG) {
        const label = result ? `${result.title} — ${result.artist} [${result.provider}]` : degraded ? "DEGRADED" : "no match";
        console.log(`[scan] ${Math.round(position)}s: ${label}`);
      }

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

  // ---------- Gap-fill pass ----------
  // A long stretch with no detection usually means a provider was blocked on
  // the way through (e.g. Shazam rate-limited while ACR lacks the song), not
  // that nothing was playing. Revisit those stretches once at the end, when
  // the provider has had time to recover. Sample points are offset by half an
  // interval so they land between the positions already tried.
  //
  // A gap is only suspicious when it is wider than the largest stride the
  // main pass can legitimately take (smart scan widens up to 3× the interval
  // while a song keeps playing) plus a crossfade margin. This adapts the
  // threshold to the chosen preset: ~50s for thorough, ~120s for fast.
  const maxStride = settings.smartScan ? settings.scanInterval * 3 : settings.scanInterval;
  const gapMinSec = maxStride + 30;
  const GAP_MAX_SAMPLES = 24;
  const gaps: { from: number; to: number }[] = [];
  {
    const byTime = [...tracks].sort((a, b) => a.timestamp - b.timestamp);
    let cursor = 0;
    for (const t of byTime) {
      if (t.timestamp - cursor >= gapMinSec) gaps.push({ from: cursor, to: t.timestamp });
      cursor = Math.max(cursor, t.lastSeen);
    }
    if (duration - cursor >= gapMinSec) gaps.push({ from: cursor, to: duration });
  }

  // The gap usually exists BECAUSE the main pass was rate-limited when it
  // went through — Shazam can soft-throttle by answering "no match" instead
  // of a hard 429. Rest before revisiting, pace slowly, and give each empty
  // gap a second round at different offsets after another rest.
  const GAP_REST_MS = 25_000;
  const GAP_RETRY_REST_MS = 15_000;
  const GAP_PACE_MS = BASE_DELAY_MS + 1_600;

  if (gaps.length > 0) {
    console.log(
      `[scan] gap-fill: ${gaps.length} gap(s):`,
      gaps.map((g) => `${Math.round(g.from)}s-${Math.round(g.to)}s`).join(", "),
    );
    await sleep(GAP_REST_MS, ctx.signal);
  }

  let gapSamples = 0;
  for (const gap of gaps) {
    let foundInGap = 0;
    // Round 1 samples halfway between the main pass positions; round 2 (only
    // when round 1 found nothing) shifts by a quarter interval.
    for (const offsetFraction of [0.5, 0.25]) {
      if (offsetFraction !== 0.5) {
        if (foundInGap > 0 || gapSamples >= GAP_MAX_SAMPLES) break;
        await sleep(GAP_RETRY_REST_MS, ctx.signal);
      }
      for (
        let pos = gap.from + settings.scanInterval * offsetFraction;
        pos < gap.to - 5 && gapSamples < GAP_MAX_SAMPLES;
        pos += settings.scanInterval
      ) {
        if (ctx.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        gapSamples += 1;
        callbacks.onProgress({
          currentTimestamp: pos,
          totalDuration: duration,
          samplesScanned,
          totalSamples,
          fileProgress: 99,
          recognizing: true,
          samplesFailed,
        });

        const wavPath = await source.getSample(
          pos,
          Math.min(settings.sampleDuration, duration - pos),
          ctx,
        );
        try {
          const { result, degraded } = await recognizeSample(wavPath, settings, ctx.signal);
          if (ctx.signal?.aborted) throw new DOMException("Aborted", "AbortError");
          if (result) {
            const key = trackKey(result.title, result.artist);
            const existing = tracks.find(
              (t) =>
                trackKey(t.title, t.artist) === key &&
                pos >= t.timestamp - settings.mergeWindow &&
                pos <= t.lastSeen + settings.mergeWindow,
            );
            if (existing) {
              // Extending a bounding track's span does not explain the middle
              // of the gap, so it deliberately doesn't count as foundInGap.
              existing.timestamp = Math.min(existing.timestamp, pos);
              existing.lastSeen = Math.max(existing.lastSeen, pos);
              callbacks.onTrackUpdated(existing);
            } else {
              foundInGap += 1;
              console.log(`[scan] gap-fill found at ${Math.round(pos)}s: ${result.title} — ${result.artist}`);
              const track: TrackEntry = {
                id: randomUUID(),
                timestamp: pos,
                lastSeen: pos,
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
          } else {
            console.log(`[scan] gap-fill at ${Math.round(pos)}s: ${degraded ? "degraded" : "no match"}`);
            if (degraded) samplesFailed += 1;
          }
        } finally {
          unlink(wavPath).catch(() => {});
        }
        samplesScanned += 1;
        await sleep(GAP_PACE_MS, ctx.signal);
      }
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

  tracks.sort((a, b) => a.timestamp - b.timestamp);
  return { tracks, samplesFailed };
}
