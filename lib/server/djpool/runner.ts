import path from "path";
import { createWriteStream, existsSync, statSync } from "fs";
import { copyFile, readdir, unlink } from "fs/promises";
import { ZipArchive } from "archiver";
import { randomUUID } from "crypto";
import { jobManager } from "@/lib/server/jobs";
import { DOWNLOADS_ROOT, jobDownloadDir, jobTempDir, sanitizeFileName } from "@/lib/server/paths";
import { toUserMessage } from "@/lib/errors";
import { downloadPoolFile, isPoolUrl } from "@/lib/server/djpool/client";
import { buildQuery, findCandidates } from "@/lib/server/djpool/matcher";
import { searchYoutube } from "@/lib/server/ytdlp";
import { youtubeToFile } from "@/lib/server/djdl/convert";
import {
  DEFAULT_DJPOOL_PREFERENCES,
  DEFAULT_SOURCE_PREFS,
  type DjPoolPreferences,
  type DjPoolTrack,
  type SourcePrefs,
  type TrackEntry,
  type TrackPin,
} from "@/lib/types";

export interface DjPoolTrackInput {
  title: string;
  artist: string;
  /** TrackEntry.id — restored onto the row after refresh. */
  id?: string;
  /** 1-based tracklist position, used as the "01 - " filename prefix. */
  num?: number;
  /** Specific version chosen in the picker — downloaded as-is, no search. */
  pin?: TrackPin;
}

export interface DjPoolRequest {
  tracks: DjPoolTrackInput[];
  preferences: DjPoolPreferences;
  sources?: SourcePrefs;
  sourceUrl?: string;
  sourceTitle?: string;
  clientTracks?: TrackEntry[];
  /** Copy already-saved files from a previous (usually cancelled) bundle. */
  resumeFromJobId?: string;
}

/** Pacing between pool requests to stay polite to the server. */
const REQUEST_DELAY_MS = 700;

/** Resolves after `ms`, or as soon as `signal` aborts (the caller re-checks it). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function numPrefix(num?: number): string {
  return num ? `${String(num).padStart(2, "0")} - ` : "";
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Failure handler for a run. Aborts are expected (Stop / Pause) and must be
 * identified by the error itself, not by the record: by the time a paused run
 * unwinds, Continue may already have swapped in a fresh AbortController and
 * set the status back to "matching".
 */
function swallowAbort(jobId: string, err: unknown): void {
  if (isAbortError(err)) return;
  const record = jobManager.get(jobId);
  if (!record || record.job.status === "cancelled" || record.job.status === "paused") return;
  console.error(`[djpool ${jobId}]`, err);
  jobManager.setStatus(jobId, "failed", toUserMessage(err));
}

/**
 * Run the worker, chained after any previous worker for this job so a Continue
 * issued while a paused run is still unwinding never has two workers writing
 * into the same download dir.
 */
function launch(jobId: string, request: DjPoolRequest, opts: { resume?: boolean } = {}): void {
  const record = jobManager.get(jobId);
  if (!record) return;
  const previous = record.runner ?? Promise.resolve();
  record.runner = previous
    .catch(() => {})
    .then(() => runDjPool(jobId, request, opts))
    .catch((err) => swallowAbort(jobId, err));
}

export function startDjPoolJob(jobId: string, request: DjPoolRequest): void {
  launch(jobId, request);
}

/** Continue a paused job from the first track that is not already saved. */
export function resumeDjPoolJob(jobId: string): boolean {
  const record = jobManager.get(jobId);
  if (!record || record.job.type !== "djpool" || record.job.status !== "paused") return false;
  const snap = record.job.djpool;
  if (!snap) return false;
  jobManager.resetAbort(jobId);
  jobManager.setStatus(jobId, "matching");
  jobManager.update(jobId, (job) => {
    for (const t of job.djpool?.tracks ?? []) {
      if (t.status === "searching" || t.status === "downloading" || t.status === "matched") {
        t.status = "pending";
        t.progress = undefined;
      }
    }
  });
  const request: DjPoolRequest = {
    tracks: snap.tracks.map((t) => ({
      id: t.clientId,
      title: t.title,
      artist: t.artist,
      num: t.num,
      pin: t.pin,
    })),
    preferences: snap.preferences ?? DEFAULT_DJPOOL_PREFERENCES,
    sources: snap.sources ?? DEFAULT_SOURCE_PREFS,
    sourceUrl: snap.sourceUrl,
    sourceTitle: snap.sourceTitle,
    clientTracks: snap.clientTracks,
  };
  launch(jobId, request, { resume: true });
  return true;
}

async function runDjPool(
  jobId: string,
  request: DjPoolRequest,
  opts: { resume?: boolean } = {},
): Promise<void> {
  const record = jobManager.get(jobId);
  if (!record) return;
  const signal = record.abort.signal;
  const prefs = { ...DEFAULT_DJPOOL_PREFERENCES, ...request.preferences };
  const sources = { ...DEFAULT_SOURCE_PREFS, ...request.sources };
  // Ordered list of sources to try per track.
  const order = (
    sources.priority === "youtube" ? (["youtube", "djpool"] as const) : (["djpool", "youtube"] as const)
  ).filter((s) => sources[s]);

  let tracks: DjPoolTrack[];
  if (opts.resume && record.job.djpool?.tracks.length) {
    tracks = record.job.djpool.tracks;
    jobManager.setStatus(jobId, "matching");
  } else {
    tracks = request.tracks.map((t) => ({
      id: randomUUID(),
      clientId: t.id,
      query: buildQuery(t.title, t.artist),
      title: t.title,
      artist: t.artist,
      num: t.num,
      status: "pending",
      pin: t.pin,
    }));

    jobManager.update(jobId, (job) => {
      job.djpool = {
        total: tracks.length,
        processed: 0,
        downloaded: 0,
        notFound: 0,
        failed: 0,
        tracks,
        sourceUrl: request.sourceUrl,
        sourceTitle: request.sourceTitle,
        clientTracks: request.clientTracks,
        preferences: prefs,
        sources,
      };
    });
    jobManager.setStatus(jobId, "matching");
  }

  const outDir = jobDownloadDir(jobId);
  const usedNames = new Set<string>();
  if (opts.resume) {
    await seedUsedNames(outDir, tracks, usedNames);
  } else if (request.resumeFromJobId) {
    await copyResumedFiles(request.resumeFromJobId, outDir, usedNames);
  }

  const patch = (id: string, mutate: (t: DjPoolTrack) => void) =>
    jobManager.update(jobId, (job) => {
      const t = job.djpool?.tracks.find((x) => x.id === id);
      if (t) mutate(t);
    });

  const bump = (field: "downloaded" | "notFound" | "failed") =>
    jobManager.update(jobId, (job) => {
      if (job.djpool) {
        job.djpool[field] += 1;
        job.djpool.processed += 1;
      }
    });

  const uniqueName = (name: string): string => {
    let fileName = sanitizeFileName(name);
    if (usedNames.has(fileName.toLowerCase())) {
      const parsed = path.parse(fileName);
      fileName = `${parsed.name} (${usedNames.size + 1})${parsed.ext}`;
    }
    usedNames.add(fileName.toLowerCase());
    return fileName;
  };

  const onProgress = (trackId: string) => (percent: number) => {
    // Every 5% is plenty for the UI and keeps SSE payload volume low.
    if (percent % 5 === 0 || percent === 100) {
      patch(trackId, (t) => {
        t.progress = percent;
      });
    }
  };

  /** Try DJ Pool for one track. Returns true when a file was saved. */
  const tryDjPool = async (track: DjPoolTrack): Promise<boolean> => {
    const { candidates, matched } = await findCandidates(track.title, track.artist, prefs);
    patch(track.id, (t) => {
      t.candidates = candidates;
    });
    if (!matched) return false;

    const best = candidates[0];
    const fileName = uniqueName(
      numPrefix(track.num) + (best.name.endsWith(`.${best.ext}`) ? best.name : `${best.name}.${best.ext}`),
    );
    patch(track.id, (t) => {
      t.status = "downloading";
      t.source = "djpool";
      t.best = best;
    });

    const dest = path.join(outDir, fileName);
    await downloadPoolFile(best.download, dest, signal, onProgress(track.id));
    finishTrack(track.id, fileName, dest, "djpool");
    return true;
  };

  /** Try YouTube for one track. Returns true when a file was saved. */
  const tryYoutube = async (track: DjPoolTrack): Promise<boolean> => {
    const results = await searchYoutube(track.query, 1, { signal });
    if (results.length === 0) return false;

    patch(track.id, (t) => {
      t.status = "downloading";
      t.source = "youtube";
    });

    const base = uniqueName(
      `${numPrefix(track.num)}${track.artist ? `${track.artist} - ` : ""}${track.title}.mp3`,
    ).replace(/\.mp3$/, "");
    const { filePath, fileName } = await youtubeToFile({
      url: results[0].url,
      format: "mp3",
      workDir: path.join(jobTempDir(jobId), `yt-${track.id}`),
      outDir,
      baseName: base,
      signal,
      onDownloadProgress: (e) => onProgress(track.id)(Math.round(e.percent ?? 0)),
    });
    finishTrack(track.id, fileName, filePath, "youtube");
    return true;
  };

  /** Download the exact version the user pinned in the picker. */
  const tryPin = async (track: DjPoolTrack, pin: TrackPin): Promise<boolean> => {
    if (pin.source === "djpool") {
      if (!sources.djpool || !isPoolUrl(pin.url)) return false;
      const fileName = uniqueName(
        numPrefix(track.num) + (pin.name || `${track.artist} - ${track.title}.mp3`),
      );
      patch(track.id, (t) => {
        t.status = "downloading";
        t.source = "djpool";
      });
      const dest = path.join(outDir, fileName);
      await downloadPoolFile(pin.url, dest, signal, onProgress(track.id));
      finishTrack(track.id, fileName, dest, "djpool");
      return true;
    }
    patch(track.id, (t) => {
      t.status = "downloading";
      t.source = "youtube";
    });
    const base = uniqueName(
      `${numPrefix(track.num)}${track.artist ? `${track.artist} - ` : ""}${track.title}.mp3`,
    ).replace(/\.mp3$/, "");
    const { filePath, fileName } = await youtubeToFile({
      url: pin.url,
      format: "mp3",
      workDir: path.join(jobTempDir(jobId), `yt-${track.id}`),
      outDir,
      baseName: base,
      signal,
      onDownloadProgress: (e) => onProgress(track.id)(Math.round(e.percent ?? 0)),
    });
    finishTrack(track.id, fileName, filePath, "youtube");
    return true;
  };

  const finishTrack = (trackId: string, fileName: string, filePath: string, source: "djpool" | "youtube") => {
    const size = (() => {
      try {
        return statSync(filePath).size;
      } catch {
        return 0;
      }
    })();
    patch(trackId, (t) => {
      t.status = "downloaded";
      t.progress = undefined;
      t.source = source;
      t.fileName = fileName;
      t.fileSize = size;
    });
    bump("downloaded");
  };

  for (const [i, track] of tracks.entries()) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (
      track.status === "downloaded" ||
      track.status === "notfound" ||
      track.status === "failed" ||
      track.status === "skipped"
    ) {
      continue;
    }

    patch(track.id, (t) => (t.status = "searching"));
    try {
      let saved = false;

      // A pinned version wins over any search; sources are the fallback.
      const pin = track.pin ?? request.tracks[i]?.pin;
      if (pin) {
        try {
          saved = await tryPin(track, pin);
        } catch (err) {
          if (signal.aborted) throw err;
          console.warn(`[djpool ${jobId}] pinned version failed for "${track.query}":`, err);
        }
      }

      for (const source of order) {
        if (saved) break;
        try {
          saved = source === "djpool" ? await tryDjPool(track) : await tryYoutube(track);
        } catch (err) {
          if (signal.aborted) throw err;
          // A source failing (e.g. YouTube bot check) should not sink the
          // whole track when another source is still available.
          console.warn(`[djpool ${jobId}] ${source} failed for "${track.query}":`, err);
        }
      }

      if (!saved) {
        patch(track.id, (t) => {
          t.status = "notfound";
        });
        bump("notFound");
      }
    } catch (err) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      console.error(`[djpool ${jobId}] track "${track.query}"`, err);
      patch(track.id, (t) => {
        t.status = "failed";
        t.error = toUserMessage(err);
      });
      bump("failed");
    }

    await sleep(REQUEST_DELAY_MS, signal);
  }

  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  // Count every audio file in the folder — includes copies from a previous Stop.
  const files = (await readdir(outDir)).filter((f) => !f.toLowerCase().endsWith(".zip"));
  if (files.length === 0) {
    jobManager.setStatus(jobId, "failed", "No tracks could be downloaded from the selected sources.");
    return;
  }

  // Bundle: a single file is served directly; multiple files are zipped.
  if (files.length === 1) {
    const only = path.join(outDir, files[0]);
    record.outputFile = only;
    jobManager.update(jobId, (job) => {
      if (job.djpool) {
        job.djpool.bundleName = files[0];
        job.djpool.bundleSize = statSync(only).size;
        if (files.length > job.djpool.downloaded) job.djpool.downloaded = files.length;
      }
    });
  } else {
    jobManager.setStatus(jobId, "processing");
    const zipName = `Tracklist - ${files.length} tracks.zip`;
    const zipPath = path.join(outDir, zipName);
    await zipFiles(outDir, files, zipPath);
    record.outputFile = zipPath;
    jobManager.update(jobId, (job) => {
      if (job.djpool) {
        job.djpool.bundleName = zipName;
        job.djpool.bundleSize = statSync(zipPath).size;
        if (files.length > job.djpool.downloaded) job.djpool.downloaded = files.length;
      }
    });
  }

  jobManager.setStatus(jobId, "completed");
}

/**
 * On resume, the job's own track list is the source of truth for what was
 * saved. Anything else in the folder is a half-written file from the run that
 * got paused — drop it so it neither lands in the zip nor steals a name.
 */
async function seedUsedNames(dir: string, tracks: DjPoolTrack[], usedNames: Set<string>): Promise<void> {
  if (!existsSync(dir)) return;
  for (const t of tracks) {
    if (t.status === "downloaded" && t.fileName) usedNames.add(t.fileName.toLowerCase());
  }
  for (const f of await readdir(dir)) {
    if (usedNames.has(f.toLowerCase())) continue;
    await unlink(path.join(dir, f)).catch((err) => console.warn(`[djpool] stale file cleanup failed for ${f}:`, err));
  }
}

function isSafeFileName(name: string): boolean {
  return name.length > 0 && !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

/** Bring over files that finished before the previous bundle was Stopped. */
async function copyResumedFiles(
  fromJobId: string,
  toDir: string,
  usedNames: Set<string>,
): Promise<number> {
  const fromDir = path.join(DOWNLOADS_ROOT, fromJobId);
  if (!existsSync(fromDir)) return 0;

  const names = new Set(
    (jobManager.get(fromJobId)?.job.djpool?.tracks ?? [])
      .filter((t) => t.status === "downloaded" && t.fileName && isSafeFileName(t.fileName))
      .map((t) => t.fileName as string),
  );
  if (names.size === 0) return 0;

  let copied = 0;
  for (const name of names) {
    const src = path.join(fromDir, name);
    if (!existsSync(src) || !statSync(src).isFile()) continue;
    try {
      await copyFile(src, path.join(toDir, name));
      usedNames.add(name.toLowerCase());
      copied += 1;
    } catch (err) {
      console.warn(`[djpool] resume copy failed for ${name}:`, err);
    }
  }
  return copied;
}

function zipFiles(dir: string, files: string[], zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 0 } }); // audio is already compressed
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    for (const file of files) archive.file(path.join(dir, file), { name: file });
    void archive.finalize();
  });
}
