import { NextRequest, NextResponse } from "next/server";
import { sessionEmail } from "@/lib/auth/session";
import { isDbConfigured } from "@/lib/server/db";
import { clearRecents, deleteRecent, listRecents, saveRecent } from "@/lib/server/recents";
import type { TrackEntry } from "@/lib/types";

export const runtime = "nodejs";

interface RecentBody {
  url?: string;
  title?: string;
  tracks?: TrackEntry[];
  kind?: string;
  at?: number;
}

/** 503 tells the client to fall back to localStorage. */
const NO_DB = NextResponse.json({ error: "no-db" }, { status: 503 });

async function requireUser(request: NextRequest): Promise<string | NextResponse> {
  const email = await sessionEmail(request);
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return email;
}

export async function GET(request: NextRequest) {
  if (!isDbConfigured()) return NO_DB;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  try {
    return NextResponse.json({ items: await listRecents(user) });
  } catch (err) {
    console.error("[GET /api/recents]", err);
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
}

/** Upsert one item, or several at once ({ items: [...] } — localStorage import). */
export async function POST(request: NextRequest) {
  if (!isDbConfigured()) return NO_DB;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  try {
    const body = (await request.json()) as RecentBody & { items?: RecentBody[] };
    const items = (body.items ?? [body]).filter((i): i is RecentBody & { url: string } =>
      Boolean(i.url?.trim()),
    );
    // Oldest first so updated_at ordering survives a bulk import.
    items.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    for (const item of items.slice(-20)) await saveRecent(user, item);
    return NextResponse.json({ items: await listRecents(user) });
  } catch (err) {
    console.error("[POST /api/recents]", err);
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
}

/** ?url=… removes one item; ?all=1 clears the list (?keep=… spares the active source). */
export async function DELETE(request: NextRequest) {
  if (!isDbConfigured()) return NO_DB;
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  try {
    const params = request.nextUrl.searchParams;
    const url = params.get("url");
    if (params.get("all") === "1") await clearRecents(user, params.get("keep") ?? undefined);
    else if (url) await deleteRecent(user, url);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/recents]", err);
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
}
