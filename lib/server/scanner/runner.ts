import { jobManager } from "@/lib/server/jobs";
import { jobTempDir } from "@/lib/server/paths";
import { toUserMessage } from "@/lib/errors";
import { isDbConfigured } from "@/lib/server/db";
import { saveRecent } from "@/lib/server/recents";
import { fetchSpotifyTracklist } from "@/lib/server/spotify";
import type { ScanMode, ScanSettings, TrackEntry } from "@/lib/types";
import type { AudioSource, AudioSourceContext } from "@/lib/server/audio/AudioSource";
import { LocalFileAudioSource } from "@/lib/server/audio/LocalFileAudioSource";
import { YouTubeAudioSource } from "@/lib/server/audio/YouTubeAudioSource";
import { scanAudioSource } from "./scanner";

export interface ScanRequest {
  mode: ScanMode;
  url?: string;
  /** Absolute paths of uploaded files (already saved into the job temp dir) */
  files?: { path: string; name: string }[];
  settings: ScanSettings;
}

/** Build the AudioSource list for a scan request. Folder = many local sources. */
function buildSources(jobId: string, request: ScanRequest): AudioSource[] {
  const tempDir = jobTempDir(jobId);
  if (request.mode === "url") {
    return [new YouTubeAudioSource(request.url!, tempDir)];
  }
  const files = [...(request.files ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return files.map((f) => new LocalFileAudioSource(f.path, f.name, tempDir));
}

/** Run a scan job asynchronously. Progress is streamed via the job manager. */
export function startScanJob(jobId: string, request: ScanRequest): void {
  void runScan(jobId, request).catch((err) => {
    const record = jobManager.get(jobId);
    if (!record) return;
    if (record.abort.signal.aborted || record.job.status === "cancelled") {
      void persistScanRecent(jobId);
      return;
    }
    console.error(`[scan ${jobId}]`, err);
    jobManager.setStatus(jobId, "failed", toUserMessage(err));
  });
}

async function runScan(jobId: string, request: ScanRequest): Promise<void> {
  const record = jobManager.get(jobId);
  if (!record) return;
  const { settings } = request;
  const signal = record.abort.signal;

  if (request.mode === "spotify") return runSpotifyScan(jobId, request.url!, signal);

  const sources = buildSources(jobId, request);
  const totalFiles = sources.length;

  jobManager.update(jobId, (job) => {
    job.scan = {
      mode: request.mode,
      sourceUrl: request.url,
      fileIndex: 0,
      totalFiles,
      currentTimestamp: 0,
      totalDuration: 0,
      samplesScanned: 0,
      totalSamples: 0,
      samplesFailed: 0,
      fileProgress: 0,
      overallProgress: 0,
      songsFound: 0,
      tracks: [],
    };
  });

  const ctx: AudioSourceContext = {
    signal,
    onSpawn: (proc) => jobManager.registerProc(jobId, proc),
  };

  let failedInPreviousFiles = 0;

  for (let fileIndex = 0; fileIndex < sources.length; fileIndex++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const source = sources[fileIndex];

    jobManager.setStatus(jobId, "preparing");
    jobManager.update(jobId, (job) => {
      if (!job.scan) return;
      job.scan.fileIndex = fileIndex;
      job.scan.currentFile = source.displayName;
      job.scan.fileProgress = 0;
      job.scan.currentTimestamp = 0;
    });

    await source.prepare({
      ...ctx,
      onPrepareProgress: (percent, statusText) => {
        jobManager.update(jobId, (job) => {
          if (job.scan) job.scan.info = { ...job.scan.info, title: statusText ?? job.scan.info?.title };
        });
        if (percent > 0 && percent < 100) jobManager.setStatus(jobId, "downloading");
      },
    });

    if (source instanceof YouTubeAudioSource && source.info) {
      const info = source.info;
      jobManager.update(jobId, (job) => {
        if (job.scan) job.scan.info = info;
      });
    }

    jobManager.setStatus(jobId, "sampling");

    const { samplesFailed } = await scanAudioSource(source, fileIndex, settings, ctx, {
      onProgress: (u) => {
        jobManager.update(jobId, (job) => {
          if (!job.scan) return;
          job.scan.currentTimestamp = u.currentTimestamp;
          job.scan.totalDuration = u.totalDuration;
          job.scan.samplesScanned = u.samplesScanned;
          job.scan.totalSamples = u.totalSamples;
          job.scan.samplesFailed = failedInPreviousFiles + u.samplesFailed;
          job.scan.fileProgress = u.fileProgress;
          job.scan.overallProgress = ((fileIndex + u.fileProgress / 100) / totalFiles) * 100;
          job.status = u.recognizing ? "recognizing" : "sampling";
        });
      },
      onTrack: (track) => {
        jobManager.update(jobId, (job) => {
          if (!job.scan) return;
          // Gap-fill detections arrive after later songs; keep time order.
          job.scan.tracks.push(track);
          job.scan.tracks.sort((a, b) => a.fileIndex - b.fileIndex || a.timestamp - b.timestamp);
          job.scan.songsFound = job.scan.tracks.length;
        });
      },
      onTrackUpdated: (track) => {
        jobManager.update(jobId, (job) => {
          if (!job.scan) return;
          const existing = job.scan.tracks.find((t) => t.id === track.id);
          if (existing) {
            // Gap-fill can extend a span backwards as well as forwards.
            existing.timestamp = track.timestamp;
            existing.lastSeen = track.lastSeen;
          }
        });
      },
    });
    failedInPreviousFiles += samplesFailed;
  }

  jobManager.update(jobId, (job) => {
    if (job.scan) job.scan.overallProgress = 100;
  });
  jobManager.setStatus(jobId, "completed");
  await persistScanRecent(jobId);
}

/**
 * Spotify links already carry the tracklist, so there is nothing to sample:
 * read the list, lay the songs out back-to-back (timestamp = where it would
 * start if the playlist were one long mix) and report them like a scan.
 */
async function runSpotifyScan(jobId: string, url: string, signal: AbortSignal): Promise<void> {
  jobManager.update(jobId, (job) => {
    job.scan = {
      mode: "spotify",
      sourceUrl: url,
      fileIndex: 0,
      totalFiles: 1,
      currentTimestamp: 0,
      totalDuration: 0,
      samplesScanned: 0,
      totalSamples: 0,
      samplesFailed: 0,
      fileProgress: 0,
      overallProgress: 0,
      songsFound: 0,
      tracks: [],
      info: { title: "Reading Spotify tracklist…" },
    };
  });
  jobManager.setStatus(jobId, "preparing");

  const list = await fetchSpotifyTracklist(url, signal);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  console.log(`[scan ${jobId}] spotify ${list.ref.type} "${list.title}": ${list.tracks.length} tracks${list.truncated ? " (first page only)" : ""}`);

  let position = 0;
  const tracks: TrackEntry[] = list.tracks.map((t, i) => {
    const seconds = Math.max(1, Math.round(t.durationMs / 1000));
    const entry: TrackEntry = {
      id: `${jobId}-${i}`,
      timestamp: position,
      lastSeen: position + seconds - 1,
      title: t.title,
      artist: t.artist,
      coverUrl: t.coverUrl,
      provider: "spotify",
      file: list.title,
      fileIndex: 0,
    };
    position += seconds;
    return entry;
  });

  jobManager.update(jobId, (job) => {
    if (!job.scan) return;
    job.scan.tracks = tracks;
    job.scan.songsFound = tracks.length;
    job.scan.totalDuration = position;
    job.scan.currentTimestamp = position;
    job.scan.fileProgress = 100;
    job.scan.overallProgress = 100;
    job.scan.info = {
      title: list.truncated ? `${list.title} (first ${tracks.length} tracks)` : list.title,
      thumbnail: list.coverUrl,
      duration: position,
    };
  });
  jobManager.setStatus(jobId, "completed");
  await persistScanRecent(jobId);
}

/** Write the finished (or stopped) tracklist to the account so a closed tab still has Recent. */
async function persistScanRecent(jobId: string): Promise<void> {
  const record = jobManager.get(jobId);
  const email = record?.ownerEmail;
  const scan = record?.job.scan;
  if (!email || !scan || !isDbConfigured()) return;
  if ((scan.mode !== "url" && scan.mode !== "spotify") || !scan.sourceUrl || scan.tracks.length === 0) return;
  try {
    await saveRecent(email, {
      url: scan.sourceUrl,
      title: scan.info?.title,
      tracks: scan.tracks,
      kind: scan.mode,
    });
  } catch (err) {
    console.error(`[scan ${jobId}] persist Recent failed:`, err);
  }
}
