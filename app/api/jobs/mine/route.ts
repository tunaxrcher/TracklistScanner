import { NextRequest, NextResponse } from "next/server";
import { sessionEmail } from "@/lib/auth/session";
import { jobManager } from "@/lib/server/jobs";
import { isSpotifyUrl } from "@/lib/spotify";
import type { Job } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Latest scan + Download All jobs for the signed-in account, so a new tab
 * (or phone) can reconnect to progress and re-download a finished ZIP.
 *
 * `?source=<url>` narrows the bundle to the one started from that tracklist
 * (Recent → View), so a list can still Continue its own stopped bundle after
 * a newer bundle was started elsewhere.
 *
 * `?panel=spotify|audio` picks which tab is asking: the Spotify tab only
 * reconnects to Spotify scans (and their bundles), the audio tab to the rest.
 */
export async function GET(request: NextRequest) {
  const email = await sessionEmail(request);
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const source = request.nextUrl.searchParams.get("source")?.trim();
  const panel = request.nextUrl.searchParams.get("panel");
  const forPanel = (url?: string, mode?: string) =>
    panel === "spotify"
      ? mode === "spotify" || (url ? isSpotifyUrl(url) : false)
      : panel === "audio"
        ? mode !== "spotify" && !(url && isSpotifyUrl(url))
        : true;
  const scan = jobManager.findLatestByOwner(email, "scan", (r) => forPanel(r.job.scan?.sourceUrl, r.job.scan?.mode))?.job ?? null;
  const djpool =
    jobManager.findLatestByOwner(email, "djpool", (r) => {
      const bundleSource = r.job.djpool?.sourceUrl?.trim();
      if (source) return bundleSource === source;
      return forPanel(bundleSource);
    })?.job ?? null;
  return NextResponse.json({ scan, djpool } satisfies { scan: Job | null; djpool: Job | null });
}
