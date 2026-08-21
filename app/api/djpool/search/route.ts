import { NextRequest, NextResponse } from "next/server";
import { searchPoolFiles, isDjPoolConfigured } from "@/lib/server/djpool/client";
import { buildQuery, rankCandidates } from "@/lib/server/djpool/matcher";
import { AppError, toUserMessage } from "@/lib/errors";
import { DEFAULT_DJPOOL_PREFERENCES, type DjPoolPreferences } from "@/lib/types";

export const runtime = "nodejs";

/** Search the pool for a single track and return ranked candidates (for manual override). */
export async function POST(request: NextRequest) {
  try {
    if (!isDjPoolConfigured()) throw new AppError("DJPOOL_NOT_CONFIGURED");

    const body = (await request.json()) as {
      title?: string;
      artist?: string;
      query?: string;
      preferences?: Partial<DjPoolPreferences>;
    };

    const title = String(body.title ?? "").trim();
    const artist = String(body.artist ?? "").trim();
    const query = String(body.query ?? "").trim() || buildQuery(title, artist);
    if (!query) return NextResponse.json({ error: "Empty query." }, { status: 400 });

    const prefs: DjPoolPreferences = { ...DEFAULT_DJPOOL_PREFERENCES, ...body.preferences };
    const files = await searchPoolFiles(query, 40, 0);
    const { candidates } = rankCandidates(title || query, artist, files, prefs, 12);

    return NextResponse.json({ query, candidates });
  } catch (err) {
    console.error("[POST /api/djpool/search]", err);
    const status = err instanceof AppError && err.code === "DJPOOL_NOT_CONFIGURED" ? 400 : 500;
    return NextResponse.json({ error: toUserMessage(err) }, { status });
  }
}
