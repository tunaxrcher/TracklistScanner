import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { writeFile, mkdir } from "fs/promises";
import { jobManager } from "@/lib/server/jobs";
import { jobTempDir } from "@/lib/server/paths";
import { startScanJob, type ScanRequest } from "@/lib/server/scanner/runner";
import { validateMediaUrl, isSupportedAudioFile, sanitizeFileName } from "@/lib/server/validate";
import { AppError, toUserMessage } from "@/lib/errors";
import { DEFAULT_SCAN_SETTINGS, type ScanMode, type ScanSettings } from "@/lib/types";

export const runtime = "nodejs";

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

    if (mode === "url") {
      const url = validateMediaUrl(String(form.get("url") ?? ""));
      scanRequest.url = url;
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

      const record = jobManager.create("scan", settings.keepTempFiles);
      const uploadDir = path.join(jobTempDir(record.job.id), "uploads");
      await mkdir(uploadDir, { recursive: true });

      const saved: { path: string; name: string }[] = [];
      for (const file of supported) {
        const name = sanitizeFileName(file.name);
        const target = path.join(uploadDir, `${saved.length}-${name}`);
        await writeFile(target, Buffer.from(await file.arrayBuffer()));
        saved.push({ path: target, name });
      }
      scanRequest.files = saved;
      startScanJob(record.job.id, scanRequest);
      return NextResponse.json({ jobId: record.job.id });
    }

    const record = jobManager.create("scan", settings.keepTempFiles);
    startScanJob(record.job.id, scanRequest);
    return NextResponse.json({ jobId: record.job.id });
  } catch (err) {
    console.error("[POST /api/jobs/scan]", err);
    const status = err instanceof AppError && err.code === "INVALID_URL" ? 400 : 500;
    return NextResponse.json({ error: toUserMessage(err) }, { status });
  }
}
