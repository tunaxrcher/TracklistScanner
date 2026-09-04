import { getDb } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { TrackEntry } from "@/lib/types";
import { canonicalMediaUrl } from "@/lib/mediaUrl";

/** Server-side shape matching the client's RecentItem. */
export interface RecentRecord {
  url: string;
  title?: string;
  at: number;
  tracks?: TrackEntry[];
  kind: "url" | "file" | "folder";
}

const MAX_ITEMS = 20;
const KINDS = new Set(["url", "file", "folder"]);

export async function upsertUser(email: string, name?: string, picture?: string): Promise<void> {
  const db = getDb();
  await db.user.upsert({
    where: { email },
    create: { email, name, picture, lastLoginAt: new Date() },
    update: { name, picture, lastLoginAt: new Date() },
  });
}

export async function listRecents(email: string): Promise<RecentRecord[]> {
  const db = getDb();
  const rows = await db.recent.findMany({
    where: { userEmail: email },
    orderBy: { updatedAt: "desc" },
    take: MAX_ITEMS,
  });
  return rows.map((r) => ({
    url: r.url,
    kind: (KINDS.has(r.kind) ? r.kind : "url") as RecentRecord["kind"],
    title: r.title ?? undefined,
    tracks: (r.tracks as TrackEntry[] | null) ?? undefined,
    at: Number(r.updatedAt),
  }));
}

export async function saveRecent(
  email: string,
  item: { url: string; title?: string; tracks?: TrackEntry[]; kind?: string; at?: number },
): Promise<void> {
  const kind = KINDS.has(item.kind ?? "") ? item.kind! : "url";
  // Same normalization as the client, so a share link copied twice (different
  // ?si= each time) updates one row instead of creating a second one.
  const url = (kind === "url" ? canonicalMediaUrl(item.url) : item.url.trim()).slice(0, 500);
  if (!url) return;
  const db = getDb();
  const title = item.title?.slice(0, 512);
  const tracks = item.tracks as unknown as Prisma.InputJsonValue | undefined;
  const updatedAt = BigInt(item.at ?? Date.now());

  // The user row normally exists (created at login), but "anonymous@local"
  // in open mode does not — create it lazily so the FK holds.
  await db.user.upsert({ where: { email }, create: { email }, update: {} });

  // Omitted fields are left untouched on update, so re-scanning a URL
  // refreshes the timestamp without wiping the saved title/tracklist.
  const upsert = () =>
    db.recent.upsert({
      where: { userEmail_url: { userEmail: email, url } },
      create: { userEmail: email, url, kind, title, tracks, updatedAt },
      update: { kind, updatedAt, ...(title !== undefined && { title }), ...(tracks !== undefined && { tracks }) },
    });
  try {
    await upsert();
  } catch (err) {
    // Two saves of the same URL can race (title + tracklist land together);
    // the loser hits the unique index on create — retry as a plain update.
    if ((err as { code?: string }).code !== "P2002") throw err;
    await upsert();
  }

  // Keep only the newest MAX_ITEMS rows per user.
  const overflow = await db.recent.findMany({
    where: { userEmail: email },
    orderBy: { updatedAt: "desc" },
    skip: MAX_ITEMS,
    select: { id: true },
  });
  if (overflow.length > 0) {
    await db.recent.deleteMany({ where: { id: { in: overflow.map((r) => r.id) } } });
  }
}

export async function deleteRecent(email: string, url: string): Promise<void> {
  const db = getDb();
  // Match both the stored key and its canonical form, so rows written before
  // URL normalization (raw share links) can still be removed from the UI.
  const keys = [...new Set([url.slice(0, 500), canonicalMediaUrl(url).slice(0, 500)])];
  await db.recent.deleteMany({ where: { userEmail: email, url: { in: keys } } });
}

/** Wipe the account's history, optionally sparing the source currently on screen. */
export async function clearRecents(email: string, keepUrl?: string): Promise<void> {
  const db = getDb();
  const keep = keepUrl ? [...new Set([keepUrl, canonicalMediaUrl(keepUrl)])] : [];
  await db.recent.deleteMany({
    where: { userEmail: email, ...(keep.length > 0 && { url: { notIn: keep } }) },
  });
}
