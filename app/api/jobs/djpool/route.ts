import { NextRequest, NextResponse } from "next/server";
import { sessionEmail } from "@/lib/auth/session";
import { jobManager } from "@/lib/server/jobs";
import { resumeDjPoolJob, startDjPoolJob, type DjPoolTrackInput } from "@/lib/server/djpool/runner";
import { isDjPoolConfigured } from "@/lib/server/djpool/client";
import { AppError, toUserMessage } from "@/lib/errors";
import {
  DEFAULT_DJPOOL_PREFERENCES,
  DEFAULT_SOURCE_PREFS,
  type DjPoolPreferences,
  type SourcePrefs,
  type TrackEntry,
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
    const owner = await sessionEmail(request);
    const latest = owner ? jobManager.findLatestByOwner(owner, "djpool") : undefined;
    if (latest?.job.status === "paused") {
      resumeDjPoolJob(latest.job.id);
      return NextResponse.json({ jobId: latest.job.id, resumed: true });
    }
    const existing = owner ? jobManager.findActiveByOwner(owner, "djpool") : undefined;
    if (existing) {
      return NextResponse.json({ jobId: existing.job.id, resumed: true });
    }

    const body = (await request.json()) as {
      tracks?: {
        id?: string;
        title?: string;
        artist?: string;
        num?: number;
        pin?: { source?: string; url?: string; name?: string };
      }[];
      preferences?: Partial<DjPoolPreferences>;
      sources?: Partial<SourcePrefs>;
      sourceUrl?: string;
      sourceTitle?: string;
      clientTracks?: TrackEntry[];
      resumeFrom?: string;
    };

    const tracks: DjPoolTrackInput[] = (body.tracks ?? [])
      .map((t) => ({
        id: typeof t.id === "string" ? t.id.slice(0, 80) : undefined,
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

    const clientTracks: TrackEntry[] = (body.clientTracks ?? []).slice(0, MAX_TRACKS).map((t) => ({
      id: String(t.id ?? "").slice(0, 80),
      timestamp: Number(t.timestamp) || 0,
      title: String(t.title ?? "").slice(0, 200),
      artist: String(t.artist ?? "").slice(0, 200),
      album: t.album,
      coverUrl: t.coverUrl,
      provider: t.provider === "acrcloud" ? "acrcloud" : "shazam",
      file: String(t.file ?? "Online Source").slice(0, 200),
      fileIndex: Number(t.fileIndex) || 0,
      lastSeen: Number(t.lastSeen) || 0,
    }));

    const resumeRaw = typeof body.resumeFrom === "string" ? body.resumeFrom.trim() : "";
    const resumeFrom =
      /^[0-9a-f-]{36}$/i.test(resumeRaw) ? jobManager.get(resumeRaw) : undefined;
    const resumeFromJobId =
      resumeFrom &&
      resumeFrom.job.type === "djpool" &&
      jobManager.canAccess(resumeFrom, owner ?? null)
        ? resumeFrom.job.id
        : undefined;

    const record = jobManager.create("djpool", { owner });
    startDjPoolJob(record.job.id, {
      tracks,
      preferences,
      sources,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 500) : undefined,
      sourceTitle: typeof body.sourceTitle === "string" ? body.sourceTitle.slice(0, 200) : undefined,
      clientTracks: clientTracks.filter((t) => t.id && t.title),
      resumeFromJobId,
    });
    return NextResponse.json({ jobId: record.job.id });
  } catch (err) {
    console.error("[POST /api/jobs/djpool]", err);
    const status = err instanceof AppError && err.code === "DJPOOL_NOT_CONFIGURED" ? 400 : 500;
    const message =
      err instanceof AppError
        ? err.message
        : err instanceof Error && err.message
          ? err.message
          : toUserMessage(err);
    return NextResponse.json({ error: message }, { status });
  }
}
