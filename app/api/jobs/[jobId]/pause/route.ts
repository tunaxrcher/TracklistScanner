import { NextRequest, NextResponse } from "next/server";
import { jobManager } from "@/lib/server/jobs";
import { isJobRecord, requireJob } from "@/lib/server/jobAccess";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const record = await requireJob(request, jobId);
  if (!isJobRecord(record)) return record;
  jobManager.pause(jobId);
  return NextResponse.json(record.job);
}
