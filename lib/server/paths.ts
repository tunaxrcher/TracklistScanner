import path from "path";
import { mkdirSync, rmSync, existsSync } from "fs";

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

/** Make a name safe to write to disk on any OS. */
export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function cleanupJobTemp(jobId: string): void {
  const dir = path.join(TEMP_ROOT, jobId);
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (err) {
    console.warn(`[temp] failed to clean ${dir}:`, err);
  }
}
