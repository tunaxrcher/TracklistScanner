import { NextRequest, NextResponse } from "next/server";
import { jobManager } from "@/lib/server/jobs";
import { startDownloadJob } from "@/lib/server/download/runner";
import { validateMediaUrl } from "@/lib/server/validate";
import { AppError, toUserMessage } from "@/lib/errors";
import { DEFAULT_DOWNLOAD_SETTINGS, type DownloadFormat, type DownloadSettings } from "@/lib/types";

export const runtime = "nodejs";

const FORMATS: DownloadFormat[] = ["mp3", "m4a", "original", "wav"];

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      url?: string;
      format?: DownloadFormat;
      settings?: Partial<DownloadSettings>;
    };

    const url = validateMediaUrl(String(body.url ?? ""));
    const format = body.format && FORMATS.includes(body.format) ? body.format : "mp3";
    const mp3Quality = [128, 192, 256, 320].includes(Number(body.settings?.mp3Quality))
      ? Number(body.settings?.mp3Quality)
      : DEFAULT_DOWNLOAD_SETTINGS.mp3Quality;
    const settings: DownloadSettings = {
      mp3Quality,
      keepTempFiles: body.settings?.keepTempFiles ?? false,
    };

    const record = jobManager.create("download", settings.keepTempFiles);
    startDownloadJob(record.job.id, { url, format, settings });
    return NextResponse.json({ jobId: record.job.id });
  } catch (err) {
    console.error("[POST /api/jobs/download]", err);
    const status = err instanceof AppError && err.code === "INVALID_URL" ? 400 : 500;
    return NextResponse.json({ error: toUserMessage(err) }, { status });
  }
}
