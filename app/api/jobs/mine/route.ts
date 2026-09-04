import { NextRequest, NextResponse } from "next/server";
import { sessionEmail } from "@/lib/auth/session";
import { jobManager } from "@/lib/server/jobs";
import type { Job } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Latest scan + Download All jobs for the signed-in account, so a new tab
 * (or phone) can reconnect to progress and re-download a finished ZIP.
 *
 * `?source=<url>` narrows the bundle to the one started from that tracklist
 * (Recent → View), so a list can still Continue its own stopped bundle after
 * a newer bundle was started elsewhere.
 */
export async function GET(request: NextRequest) {
  const email = await sessionEmail(request);
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const source = request.nextUrl.searchParams.get("source")?.trim();
  const scan = jobManager.findLatestByOwner(email, "scan")?.job ?? null;
  const djpool =
    jobManager.findLatestByOwner(email, "djpool", (r) =>
      source ? r.job.djpool?.sourceUrl?.trim() === source : true,
    )?.job ?? null;
  return NextResponse.json({ scan, djpool } satisfies { scan: Job | null; djpool: Job | null });
}
