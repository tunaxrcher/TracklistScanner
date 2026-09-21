/** Spotify link helpers — pure, safe on both client and server. */

export type SpotifyEntityType = "playlist" | "album" | "track";

export interface SpotifyRef {
  type: SpotifyEntityType;
  id: string;
}

const TYPES = new Set<string>(["playlist", "album", "track"]);
const ID_RE = /^[0-9A-Za-z]{22}$/;

/**
 * Parse any common Spotify link into { type, id }:
 *   https://open.spotify.com/playlist/<id>?si=…
 *   https://open.spotify.com/intl-th/album/<id>
 *   https://open.spotify.com/embed/track/<id>
 *   spotify:playlist:<id>
 */
export function parseSpotifyUrl(raw: string): SpotifyRef | null {
  const trimmed = raw.trim();
  const uri = trimmed.match(/^spotify:(playlist|album|track):([0-9A-Za-z]{22})$/);
  if (uri) return { type: uri[1] as SpotifyEntityType, id: uri[2] };
  try {
    const url = new URL(trimmed);
    if (!/(^|\.)spotify\.com$/.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // Drop locale ("intl-th") and "embed" prefixes.
    while (parts.length > 2 && (parts[0] === "embed" || /^intl-/.test(parts[0]))) parts.shift();
    const [type, id] = parts;
    if (!type || !id || !TYPES.has(type) || !ID_RE.test(id)) return null;
    return { type: type as SpotifyEntityType, id };
  } catch {
    return null;
  }
}

/** One stable key per Spotify entity (share links differ by ?si= every copy). */
export function canonicalSpotifyUrl(ref: SpotifyRef): string {
  return `https://open.spotify.com/${ref.type}/${ref.id}`;
}

export function isSpotifyUrl(raw: string): boolean {
  return parseSpotifyUrl(raw) !== null;
}

export function spotifyEmbedUrl(raw: string): string | null {
  const ref = parseSpotifyUrl(raw);
  return ref ? `https://open.spotify.com/embed/${ref.type}/${ref.id}` : null;
}
