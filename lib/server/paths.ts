import path from "path";
import { mkdirSync, rmSync, existsSync, readdirSync, statSync } from "fs";

const ROOT = process.cwd();

export const TEMP_ROOT = path.join(ROOT, "temp", "jobs");
export const DOWNLOADS_ROOT = path.join(ROOT, "downloads");

/** Temp working dir for a job: /temp/jobs/{jobId}/ */
export function jobTempDir(jobId: string): string {
  const dir = path.join(TEMP_ROOT, jobId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Final output dir for download jobs (not treated as temp). */
export function jobDownloadDir(jobId: string): string {
  const dir = path.join(DOWNLOADS_ROOT, jobId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Make a name safe to write to disk on any OS: no path separators (so it can
 * never escape its directory), no reserved characters, and never a bare
 * "." / ".." — callers must always join it under a server-chosen dir.
 */
export function sanitizeFileName(name: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "")
    .slice(0, 180);
  return clean || "file";
}

function removeDir(dir: string, label: string): void {
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (err) {
    console.warn(`[${label}] failed to clean ${dir}:`, err);
  }
}

export function cleanupJobTemp(jobId: string): void {
  removeDir(path.join(TEMP_ROOT, jobId), "temp");
}

export function cleanupJobDownloads(jobId: string): void {
  removeDir(path.join(DOWNLOADS_ROOT, jobId), "downloads");
}

/**
 * Remove job folders left behind by a previous process (crash, restart):
 * nothing can serve them once the in-memory job record is gone. `keep` holds
 * the ids the job manager still knows about — those are never touched here,
 * however old, since a slow download may not write to its folder for a while.
 */
export function sweepOrphanedJobDirs(olderThanMs: number, keep: ReadonlySet<string> = new Set()): void {
  const cutoff = Date.now() - olderThanMs;
  for (const root of [TEMP_ROOT, DOWNLOADS_ROOT]) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || keep.has(entry.name)) continue;
      const dir = path.join(root, entry.name);
      try {
        if (statSync(dir).mtimeMs < cutoff) removeDir(dir, "sweep");
      } catch {
        /* vanished meanwhile */
      }
    }
  }
}
