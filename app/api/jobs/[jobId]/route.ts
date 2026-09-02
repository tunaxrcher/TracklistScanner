import { NextRequest, NextResponse } from "next/server";
import { isJobRecord, requireJob } from "@/lib/server/jobAccess";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const record = await requireJob(request, jobId);
  if (!isJobRecord(record)) return record;
  return NextResponse.json(record.job);
}
