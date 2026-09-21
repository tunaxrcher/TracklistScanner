import { NextRequest, NextResponse } from "next/server";
import { searchPoolFiles, isDjPoolConfigured } from "@/lib/server/djpool/client";
import { findCandidates, logSearch, poolFetchLimit, rankCandidates } from "@/lib/server/djpool/matcher";
import { AppError, toUserMessage } from "@/lib/errors";
import { DEFAULT_DJPOOL_PREFERENCES, type DjPoolPreferences } from "@/lib/types";

export const runtime = "nodejs";

/** Picker page sizes: the first open shows DEFAULT_LIMIT, "Show more" asks for MAX_LIMIT. */
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 60;

/** Search the pool for a single track and return ranked candidates (for manual override). */
export async function POST(request: NextRequest) {
  try {
    if (!isDjPoolConfigured()) throw new AppError("DJPOOL_NOT_CONFIGURED");

    const body = (await request.json()) as {
      title?: string;
      artist?: string;
      query?: string;
      limit?: number;
      preferences?: Partial<DjPoolPreferences>;
    };

    const title = String(body.title ?? "").trim();
    const artist = String(body.artist ?? "").trim();
    const customQuery = String(body.query ?? "").trim();
    if (!customQuery && !title) return NextResponse.json({ error: "Empty query." }, { status: 400 });
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(body.limit) || DEFAULT_LIMIT)));

    const prefs: DjPoolPreferences = { ...DEFAULT_DJPOOL_PREFERENCES, ...body.preferences };

    // A custom query bypasses the two-pass title/artist matching.
    if (customQuery) {
      const files = await searchPoolFiles(customQuery, poolFetchLimit(limit), 0);
      const ranked = rankCandidates(title || customQuery, artist, files, prefs, limit);
      logSearch("custom", customQuery, files.length, ranked, prefs);
      return NextResponse.json({ query: customQuery, ...ranked });
    }

    return NextResponse.json(await findCandidates(title, artist, prefs, limit));
  } catch (err) {
    console.error("[POST /api/djpool/search]", err);
    const status = err instanceof AppError && err.code === "DJPOOL_NOT_CONFIGURED" ? 400 : 500;
    return NextResponse.json({ error: toUserMessage(err) }, { status });
  }
}
