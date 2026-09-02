import { NextRequest, NextResponse } from "next/server";
import { jobManager } from "@/lib/server/jobs";
import { resumeDjPoolJob } from "@/lib/server/djpool/runner";
import { isJobRecord, requireJob } from "@/lib/server/jobAccess";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const record = await requireJob(request, jobId);
  if (!isJobRecord(record)) return record;
  if (record.job.status !== "paused") {
    return NextResponse.json(record.job);
  }
  resumeDjPoolJob(jobId);
  return NextResponse.json(jobManager.get(jobId)?.job ?? record.job);
}
