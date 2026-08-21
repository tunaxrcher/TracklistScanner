import path from "path";
import { createWriteStream, statSync } from "fs";
import { readdir } from "fs/promises";
import { ZipArchive } from "archiver";
import { randomUUID } from "crypto";
import { jobManager } from "@/lib/server/jobs";
import { jobDownloadDir } from "@/lib/server/paths";
import { toUserMessage } from "@/lib/errors";
import { downloadPoolFile } from "@/lib/server/djpool/client";
import { buildQuery, findCandidates } from "@/lib/server/djpool/matcher";
import { DEFAULT_DJPOOL_PREFERENCES, type DjPoolPreferences, type DjPoolTrack } from "@/lib/types";

export interface DjPoolTrackInput {
  title: string;
  artist: string;
}

export interface DjPoolRequest {
  tracks: DjPoolTrackInput[];
  preferences: DjPoolPreferences;
}

/** Pacing between pool requests to stay polite to the server. */
const REQUEST_DELAY_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180);
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

  const tracks: DjPoolTrack[] = request.tracks.map((t) => ({
    id: randomUUID(),
    query: buildQuery(t.title, t.artist),
    title: t.title,
    artist: t.artist,
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

  for (const track of tracks) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    patch(track.id, (t) => (t.status = "searching"));
    try {
      const { candidates, matched } = await findCandidates(track.title, track.artist, prefs);

      if (!matched) {
        patch(track.id, (t) => {
          t.status = "notfound";
          t.candidates = [];
        });
        jobManager.update(jobId, (job) => {
          if (job.djpool) {
            job.djpool.notFound += 1;
            job.djpool.processed += 1;
          }
        });
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const best = candidates[0];
      patch(track.id, (t) => {
        t.status = "downloading";
        t.best = best;
        t.candidates = candidates;
      });

      let fileName = sanitizeFileName(best.name.endsWith(`.${best.ext}`) ? best.name : `${best.name}.${best.ext}`);
      // Avoid collisions when multiple tracks resolve to same name.
      if (usedNames.has(fileName.toLowerCase())) {
        const parsed = path.parse(fileName);
        fileName = `${parsed.name} (${usedNames.size + 1})${parsed.ext}`;
      }
      usedNames.add(fileName.toLowerCase());

      const dest = path.join(outDir, fileName);
      const { bytes, serverName } = await downloadPoolFile(best.download, dest, signal, (percent) => {
        // Every 5% is plenty for the UI and keeps SSE payload volume low.
        if (percent % 5 === 0 || percent === 100) {
          patch(track.id, (t) => {
            t.progress = percent;
          });
        }
      });
      const size = (() => {
        try {
          return statSync(dest).size;
        } catch {
          return bytes;
        }
      })();

      patch(track.id, (t) => {
        t.status = "downloaded";
        t.progress = undefined;
        t.fileName = serverName ? sanitizeFileName(serverName) : fileName;
        t.fileSize = size;
      });
      jobManager.update(jobId, (job) => {
        if (job.djpool) {
          job.djpool.downloaded += 1;
          job.djpool.processed += 1;
        }
      });
    } catch (err) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      console.error(`[djpool ${jobId}] track "${track.query}"`, err);
      patch(track.id, (t) => {
        t.status = "failed";
        t.error = toUserMessage(err);
      });
      jobManager.update(jobId, (job) => {
        if (job.djpool) {
          job.djpool.failed += 1;
          job.djpool.processed += 1;
        }
      });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const downloaded = record.job.djpool?.downloaded ?? 0;
  if (downloaded === 0) {
    jobManager.setStatus(jobId, "failed", "No matching tracks were found on DJ Pool Records.");
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
    const zipName = `DJ Pool Records - ${downloaded} tracks.zip`;
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
