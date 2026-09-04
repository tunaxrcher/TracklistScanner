import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { sessionEmail } from "@/lib/auth/session";
import { jobManager } from "@/lib/server/jobs";
import { jobTempDir, sanitizeFileName } from "@/lib/server/paths";
import { startScanJob, type ScanRequest } from "@/lib/server/scanner/runner";
import { validateMediaUrl, isSupportedAudioFile } from "@/lib/server/validate";
import { AppError, toUserMessage } from "@/lib/errors";
import { DEFAULT_SCAN_SETTINGS, type ScanMode, type ScanSettings } from "@/lib/types";

export const runtime = "nodejs";

/** Upload limits for local file/folder scans (a DJ set is ~100-300 MB). */
const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;

function parseSettings(raw: string | null): ScanSettings {
  if (!raw) return DEFAULT_SCAN_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<ScanSettings>;
    const clamp = (v: unknown, min: number, max: number, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    return {
      scanInterval: clamp(parsed.scanInterval, 10, 600, DEFAULT_SCAN_SETTINGS.scanInterval),
      sampleDuration: clamp(parsed.sampleDuration, 5, 20, DEFAULT_SCAN_SETTINGS.sampleDuration),
      smartScan: parsed.smartScan ?? DEFAULT_SCAN_SETTINGS.smartScan,
      mergeWindow: clamp(parsed.mergeWindow, 0, 3600, DEFAULT_SCAN_SETTINGS.mergeWindow),
      useShazam: parsed.useShazam ?? DEFAULT_SCAN_SETTINGS.useShazam,
      useAcrCloud: parsed.useAcrCloud ?? DEFAULT_SCAN_SETTINGS.useAcrCloud,
      keepTempFiles: parsed.keepTempFiles ?? DEFAULT_SCAN_SETTINGS.keepTempFiles,
    };
  } catch {
    return DEFAULT_SCAN_SETTINGS;
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const mode = form.get("mode") as ScanMode;
    if (mode !== "url" && mode !== "file" && mode !== "folder") {
      return NextResponse.json({ error: "Invalid scan mode." }, { status: 400 });
    }
    const settings = parseSettings(form.get("settings") as string | null);

    const scanRequest: ScanRequest = { mode, settings };

    const owner = await sessionEmail(request);
    if (!owner) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const active = jobManager.findActiveByOwner(owner, "scan");
    if (active) jobManager.cancel(active.job.id);

    if (mode === "url") {
      scanRequest.url = validateMediaUrl(String(form.get("url") ?? ""));
    } else {
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      const supported = files.filter((f) => isSupportedAudioFile(f.name));
      if (supported.length === 0) {
        return NextResponse.json(
          { error: "No supported audio files were provided." },
          { status: 400 },
        );
      }
      if (mode === "file" && supported.length > 1) supported.length = 1;
      if (supported.length > MAX_FILES) {
        return NextResponse.json({ error: `Too many files (max ${MAX_FILES} per scan).` }, { status: 413 });
      }
      const totalBytes = supported.reduce((sum, f) => sum + f.size, 0);
      if (totalBytes > MAX_TOTAL_BYTES) {
        return NextResponse.json({ error: "Upload too large (max 4 GB per scan)." }, { status: 413 });
      }

      const record = jobManager.create("scan", { keepTemp: settings.keepTempFiles, owner });
      const uploadDir = path.join(jobTempDir(record.job.id), "uploads");
      await mkdir(uploadDir, { recursive: true });

      const saved: { path: string; name: string }[] = [];
      try {
        for (const file of supported) {
          const name = sanitizeFileName(file.name);
          const target = path.join(uploadDir, `${saved.length}-${name}`);
          // Stream to disk — a folder of full-length sets must not be buffered in RAM.
          await pipeline(
            Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]),
            createWriteStream(target),
          );
          saved.push({ path: target, name });
        }
      } catch (err) {
        // Don't leave a queued job (and its temp dir) behind on a broken upload.
        jobManager.setStatus(record.job.id, "failed", "Upload failed.");
        throw err;
      }
      scanRequest.files = saved;
      startScanJob(record.job.id, scanRequest);
      return NextResponse.json({ jobId: record.job.id });
    }

    const record = jobManager.create("scan", { keepTemp: settings.keepTempFiles, owner });
    startScanJob(record.job.id, scanRequest);
    return NextResponse.json({ jobId: record.job.id });
  } catch (err) {
    console.error("[POST /api/jobs/scan]", err);
    const status = err instanceof AppError && err.code === "INVALID_URL" ? 400 : 500;
    return NextResponse.json({ error: toUserMessage(err) }, { status });
  }
}
