import { NextRequest, NextResponse } from "next/server";
import { searchPoolFiles, isDjPoolConfigured } from "@/lib/server/djpool/client";
import { findCandidates, rankCandidates } from "@/lib/server/djpool/matcher";
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
    const customQuery = String(body.query ?? "").trim();
    if (!customQuery && !title) return NextResponse.json({ error: "Empty query." }, { status: 400 });

    const prefs: DjPoolPreferences = { ...DEFAULT_DJPOOL_PREFERENCES, ...body.preferences };

    // A custom query bypasses the two-pass title/artist matching.
    if (customQuery) {
      const files = await searchPoolFiles(customQuery, 40, 0);
      const { candidates, matched } = rankCandidates(title || customQuery, artist, files, prefs, 12);
      return NextResponse.json({ query: customQuery, candidates, matched });
    }

    const { query, candidates, matched } = await findCandidates(title, artist, prefs, 12);
    return NextResponse.json({ query, candidates, matched });
  } catch (err) {
    console.error("[POST /api/djpool/search]", err);
    const status = err instanceof AppError && err.code === "DJPOOL_NOT_CONFIGURED" ? 400 : 500;
    return NextResponse.json({ error: toUserMessage(err) }, { status });
  }
}
