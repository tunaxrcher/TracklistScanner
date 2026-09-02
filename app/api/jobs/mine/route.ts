import { NextRequest, NextResponse } from "next/server";
import { sessionEmail } from "@/lib/auth/session";
import { jobManager } from "@/lib/server/jobs";
import type { Job } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Latest scan + Download All jobs for the signed-in account, so a new tab
 * (or phone) can reconnect to progress and re-download a finished ZIP.
 */
export async function GET(request: NextRequest) {
  const email = await sessionEmail(request);
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const scan = jobManager.findLatestByOwner(email, "scan")?.job ?? null;
  const djpool = jobManager.findLatestByOwner(email, "djpool")?.job ?? null;
  return NextResponse.json({ scan, djpool } satisfies { scan: Job | null; djpool: Job | null });
}
