import { NextRequest, NextResponse } from "next/server";
import { jobManager } from "@/lib/server/jobs";
import { startDjPoolJob, type DjPoolTrackInput } from "@/lib/server/djpool/runner";
import { isDjPoolConfigured } from "@/lib/server/djpool/client";
import { AppError, toUserMessage } from "@/lib/errors";
import {
  DEFAULT_DJPOOL_PREFERENCES,
  DEFAULT_SOURCE_PREFS,
  type DjPoolPreferences,
  type SourcePrefs,
  type TrackPin,
  type VersionPreference,
} from "@/lib/types";

export const runtime = "nodejs";

const MAX_TRACKS = 200;
const VERSIONS: VersionPreference[] = ["clean", "dirty", "either"];

function parsePin(raw?: { source?: string; url?: string; name?: string }): TrackPin | undefined {
  if (!raw || typeof raw.url !== "string" || raw.url.length === 0) return undefined;
  const source = raw.source === "djpool" || raw.source === "youtube" ? raw.source : null;
  if (!source) return undefined;
  return {
    source,
    url: raw.url.slice(0, 1000),
    name: typeof raw.name === "string" ? raw.name.slice(0, 200) : undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      tracks?: {
        title?: string;
        artist?: string;
        num?: number;
        pin?: { source?: string; url?: string; name?: string };
      }[];
      preferences?: Partial<DjPoolPreferences>;
      sources?: Partial<SourcePrefs>;
    };

    const tracks: DjPoolTrackInput[] = (body.tracks ?? [])
      .map((t) => ({
        title: String(t.title ?? "").trim(),
        artist: String(t.artist ?? "").trim(),
        num: Number.isFinite(t.num) ? Number(t.num) : undefined,
        pin: parsePin(t.pin),
      }))
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

    const s = body.sources ?? {};
    const sources: SourcePrefs = {
      djpool: s.djpool ?? DEFAULT_SOURCE_PREFS.djpool,
      youtube: s.youtube ?? DEFAULT_SOURCE_PREFS.youtube,
      priority: s.priority === "youtube" ? "youtube" : "djpool",
    };
    if (!sources.djpool && !sources.youtube) {
      return NextResponse.json({ error: "No download source selected." }, { status: 400 });
    }
    // The pool is only required when it is actually going to be used.
    if (sources.djpool && !isDjPoolConfigured()) throw new AppError("DJPOOL_NOT_CONFIGURED");

    const record = jobManager.create("djpool");
    startDjPoolJob(record.job.id, { tracks, preferences, sources });
    return NextResponse.json({ jobId: record.job.id });
  } catch (err) {
    console.error("[POST /api/jobs/djpool]", err);
    const status = err instanceof AppError && err.code === "DJPOOL_NOT_CONFIGURED" ? 400 : 500;
    return NextResponse.json({ error: toUserMessage(err) }, { status });
  }
}
