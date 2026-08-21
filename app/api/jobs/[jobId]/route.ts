import { NextRequest, NextResponse } from "next/server";
import { jobManager } from "@/lib/server/jobs";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const record = jobManager.get(jobId);
  if (!record) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json(record.job);
}
