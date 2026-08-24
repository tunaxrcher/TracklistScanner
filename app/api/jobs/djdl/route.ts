import { NextRequest, NextResponse } from "next/server";
import { jobManager } from "@/lib/server/jobs";
import { startDjDlJob } from "@/lib/server/djdl/runner";
import type { DjDownloadFormat } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { url?: string; format?: string };
  const url = String(body.url ?? "").trim();
  const format: DjDownloadFormat = body.format === "mp3" ? "mp3" : "wav";

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return NextResponse.json({ error: "Please paste a full http(s) URL." }, { status: 400 });
  }

  const record = jobManager.create("djdl");
  startDjDlJob(record.job.id, { url, format });
  return NextResponse.json({ jobId: record.job.id });
}
