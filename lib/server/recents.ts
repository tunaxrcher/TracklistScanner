import { getDb } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { TrackEntry } from "@/lib/types";

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
  const url = item.url.trim().slice(0, 500);
  if (!url) return;
  const db = getDb();
  const kind = KINDS.has(item.kind ?? "") ? item.kind! : "url";
  const title = item.title?.slice(0, 512);
  const tracks = item.tracks as unknown as Prisma.InputJsonValue | undefined;
  const updatedAt = BigInt(item.at ?? Date.now());

  // The user row normally exists (created at login), but "anonymous@local"
  // in open mode does not — create it lazily so the FK holds.
  await db.user.upsert({ where: { email }, create: { email }, update: {} });

  // Omitted fields are left untouched on update, so re-scanning a URL
  // refreshes the timestamp without wiping the saved title/tracklist.
  await db.recent.upsert({
    where: { userEmail_url: { userEmail: email, url } },
    create: { userEmail: email, url, kind, title, tracks, updatedAt },
    update: { kind, updatedAt, ...(title !== undefined && { title }), ...(tracks !== undefined && { tracks }) },
  });

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
  await db.recent.deleteMany({ where: { userEmail: email, url: url.slice(0, 500) } });
}

export async function clearRecents(email: string): Promise<void> {
  const db = getDb();
  await db.recent.deleteMany({ where: { userEmail: email } });
}
