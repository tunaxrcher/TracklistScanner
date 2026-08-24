import path from "path";
import { createWriteStream, statSync } from "fs";
import { readdir } from "fs/promises";
import { ZipArchive } from "archiver";
import { randomUUID } from "crypto";
import { jobManager } from "@/lib/server/jobs";
import { jobDownloadDir, jobTempDir, sanitizeFileName } from "@/lib/server/paths";
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
  type TrackPin,
} from "@/lib/types";

export interface DjPoolTrackInput {
  title: string;
  artist: string;
  /** 1-based tracklist position, used as the "01 - " filename prefix. */
  num?: number;
  /** Specific version chosen in the picker — downloaded as-is, no search. */
  pin?: TrackPin;
}

export interface DjPoolRequest {
  tracks: DjPoolTrackInput[];
  preferences: DjPoolPreferences;
  sources?: SourcePrefs;
}

/** Pacing between pool requests to stay polite to the server. */
const REQUEST_DELAY_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function numPrefix(num?: number): string {
  return num ? `${String(num).padStart(2, "0")} - ` : "";
}

export function startDjPoolJob(jobId: string, request: DjPoolRequest): void {
  void runDjPool(jobId, request).catch((err) => {
    const record = jobManager.get(jobId);
    if (!record) return;
    if (record.abort.signal.aborted || record.job.status === "cancelled") return;
    console.error(`[djpool ${jobId}]`, err);
    jobManager.setStatus(jobId, "failed", toUserMessage(err));
  });
}

async function runDjPool(jobId: string, request: DjPoolRequest): Promise<void> {
  const record = jobManager.get(jobId);
  if (!record) return;
  const signal = record.abort.signal;
  const prefs = { ...DEFAULT_DJPOOL_PREFERENCES, ...request.preferences };
  const sources = { ...DEFAULT_SOURCE_PREFS, ...request.sources };
  // Ordered list of sources to try per track.
  const order = (
    sources.priority === "youtube" ? (["youtube", "djpool"] as const) : (["djpool", "youtube"] as const)
  ).filter((s) => sources[s]);

  const tracks: DjPoolTrack[] = request.tracks.map((t) => ({
    id: randomUUID(),
    query: buildQuery(t.title, t.artist),
    title: t.title,
    artist: t.artist,
    num: t.num,
    status: "pending",
  }));

  jobManager.update(jobId, (job) => {
    job.djpool = {
      total: tracks.length,
      processed: 0,
      downloaded: 0,
      notFound: 0,
      failed: 0,
      tracks,
    };
  });
  jobManager.setStatus(jobId, "matching");

  const outDir = jobDownloadDir(jobId);
  const usedNames = new Set<string>();

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

    patch(track.id, (t) => (t.status = "searching"));
    try {
      let saved = false;

      // A pinned version wins over any search; sources are the fallback.
      const pin = request.tracks[i]?.pin;
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

    await sleep(REQUEST_DELAY_MS);
  }

  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const downloaded = record.job.djpool?.downloaded ?? 0;
  if (downloaded === 0) {
    jobManager.setStatus(jobId, "failed", "No tracks could be downloaded from the selected sources.");
    return;
  }

  // Bundle: a single file is served directly; multiple files are zipped.
  const files = (await readdir(outDir)).filter((f) => !f.endsWith(".zip"));
  if (files.length === 1) {
    const only = path.join(outDir, files[0]);
    record.outputFile = only;
    jobManager.update(jobId, (job) => {
      if (job.djpool) {
        job.djpool.bundleName = files[0];
        job.djpool.bundleSize = statSync(only).size;
      }
    });
  } else {
    jobManager.setStatus(jobId, "processing");
    const zipName = `Tracklist - ${downloaded} tracks.zip`;
    const zipPath = path.join(outDir, zipName);
    await zipFiles(outDir, files, zipPath);
    record.outputFile = zipPath;
    jobManager.update(jobId, (job) => {
      if (job.djpool) {
        job.djpool.bundleName = zipName;
        job.djpool.bundleSize = statSync(zipPath).size;
      }
    });
  }

  jobManager.setStatus(jobId, "completed");
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
