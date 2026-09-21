import { youtubeId } from "@/lib/client/youtube";
import { canonicalSpotifyUrl, parseSpotifyUrl } from "@/lib/spotify";

/**
 * One stable key per piece of media, for Recent and for "is this the same
 * source" checks. YouTube share links carry a per-copy tracking id
 * (`?si=…`) and come in many shapes (youtu.be, /shorts/, m.youtube.com, …),
 * so the same video would otherwise pile up as separate Recent entries.
 * Spotify share links likewise carry `?si=…` and locale prefixes. Other URLs
 * are only trimmed and stripped of a trailing slash.
 * Pure function — safe on both client and server.
 */
export function canonicalMediaUrl(raw: string): string {
  const trimmed = raw.trim();
  const id = youtubeId(trimmed);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  const spotify = parseSpotifyUrl(trimmed);
  if (spotify) return canonicalSpotifyUrl(spotify);
  return trimmed.replace(/\/+$/, "");
}
