import { NextRequest, NextResponse } from "next/server";
import { jobManager } from "@/lib/server/jobs";
import { startDjPoolJob, type DjPoolTrackInput } from "@/lib/server/djpool/runner";
import { isDjPoolConfigured } from "@/lib/server/djpool/client";
import { AppError, toUserMessage } from "@/lib/errors";
import {
  DEFAULT_DJPOOL_PREFERENCES,
  type DjPoolPreferences,
  type VersionPreference,
} from "@/lib/types";

export const runtime = "nodejs";

const MAX_TRACKS = 200;
const VERSIONS: VersionPreference[] = ["clean", "dirty", "either"];

export async function POST(request: NextRequest) {
  try {
    if (!isDjPoolConfigured()) throw new AppError("DJPOOL_NOT_CONFIGURED");

    const body = (await request.json()) as {
      tracks?: { title?: string; artist?: string }[];
      preferences?: Partial<DjPoolPreferences>;
    };

    const tracks: DjPoolTrackInput[] = (body.tracks ?? [])
      .map((t) => ({ title: String(t.title ?? "").trim(), artist: String(t.artist ?? "").trim() }))
      .filter((t) => t.title.length > 0)
      .slice(0, MAX_TRACKS);

    if (tracks.length === 0) {
      return NextResponse.json({ error: "No tracks to download." }, { status: 400 });
    }

    const p = body.preferences ?? {};
    const preferences: DjPoolPreferences = {
      versionPreference: VERSIONS.includes(p.versionPreference as VersionPreference)
        ? (p.versionPreference as VersionPreference)
        : DEFAULT_DJPOOL_PREFERENCES.versionPreference,
      avoidAcapella: p.avoidAcapella ?? DEFAULT_DJPOOL_PREFERENCES.avoidAcapella,
      avoidInstrumental: p.avoidInstrumental ?? DEFAULT_DJPOOL_PREFERENCES.avoidInstrumental,
      avoidIntroOutro: p.avoidIntroOutro ?? DEFAULT_DJPOOL_PREFERENCES.avoidIntroOutro,
      avoidRemix: p.avoidRemix ?? DEFAULT_DJPOOL_PREFERENCES.avoidRemix,
    };

    const record = jobManager.create("djpool");
    startDjPoolJob(record.job.id, { tracks, preferences });
    return NextResponse.json({ jobId: record.job.id });
  } catch (err) {
    console.error("[POST /api/jobs/djpool]", err);
    const status = err instanceof AppError && err.code === "DJPOOL_NOT_CONFIGURED" ? 400 : 500;
    return NextResponse.json({ error: toUserMessage(err) }, { status });
  }
}
