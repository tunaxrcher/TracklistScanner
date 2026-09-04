import { NextRequest, NextResponse } from "next/server";
import { sessionEmail } from "@/lib/auth/session";
import { jobManager } from "@/lib/server/jobs";
import { startDjDlJob } from "@/lib/server/djdl/runner";
import { validateMediaUrl } from "@/lib/server/validate";
import { toUserMessage } from "@/lib/errors";
import type { DjDownloadFormat } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { url?: string; format?: string };
  const format: DjDownloadFormat = body.format === "mp3" ? "mp3" : "wav";

  let url: string;
  try {
    url = validateMediaUrl(String(body.url ?? ""));
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 400 });
  }

  const owner = await sessionEmail(request);
  if (!owner) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const record = jobManager.create("djdl", { owner });
  startDjDlJob(record.job.id, { url, format });
  return NextResponse.json({ jobId: record.job.id });
}
