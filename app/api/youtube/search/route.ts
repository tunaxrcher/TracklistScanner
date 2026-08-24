import { NextRequest, NextResponse } from "next/server";
import { searchYoutube } from "@/lib/server/ytdlp";
import { buildQuery } from "@/lib/server/djpool/matcher";
import { toUserMessage } from "@/lib/errors";

export const runtime = "nodejs";

/** Search YouTube for a detected track (used by the "Choose a version" picker). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { title?: string; artist?: string; query?: string };
    const title = String(body.title ?? "").trim();
    const artist = String(body.artist ?? "").trim();
    const query = String(body.query ?? "").trim() || buildQuery(title, artist);
    if (!query) return NextResponse.json({ error: "Empty query." }, { status: 400 });

    const results = await searchYoutube(query, 5);
    return NextResponse.json({ query, results });
  } catch (err) {
    console.error("[POST /api/youtube/search]", err);
    return NextResponse.json({ error: toUserMessage(err) }, { status: 500 });
  }
}
