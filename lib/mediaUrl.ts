import { youtubeId } from "@/lib/client/youtube";

/**
 * One stable key per piece of media, for Recent and for "is this the same
 * source" checks. YouTube share links carry a per-copy tracking id
 * (`?si=…`) and come in many shapes (youtu.be, /shorts/, m.youtube.com, …),
 * so the same video would otherwise pile up as separate Recent entries.
 * Non-YouTube URLs are only trimmed and stripped of a trailing slash.
 * Pure function — safe on both client and server.
 */
export function canonicalMediaUrl(raw: string): string {
  const trimmed = raw.trim();
  const id = youtubeId(trimmed);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  return trimmed.replace(/\/+$/, "");
}
