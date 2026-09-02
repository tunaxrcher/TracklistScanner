import { NextRequest, NextResponse } from "next/server";
import { sessionEmail } from "@/lib/auth/session";
import { jobManager, type JobRecord } from "@/lib/server/jobs";

/** Load a job the caller is allowed to see. 404 hides existence from other accounts. */
export async function requireJob(
  request: NextRequest,
  jobId: string,
): Promise<JobRecord | NextResponse> {
  const record = jobManager.get(jobId);
  if (!record) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const email = await sessionEmail(request);
  if (!jobManager.canAccess(record, email)) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  return record;
}

export function isJobRecord(value: JobRecord | NextResponse): value is JobRecord {
  return !(value instanceof NextResponse);
}
