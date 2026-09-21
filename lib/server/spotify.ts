import { AppError } from "@/lib/errors";
import { parseSpotifyUrl, type SpotifyRef } from "@/lib/spotify";

export interface SpotifyTrack {
  title: string;
  artist: string;
  /** Milliseconds */
  durationMs: number;
  coverUrl?: string;
}

export interface SpotifyTracklist {
  ref: SpotifyRef;
  title: string;
  coverUrl?: string;
  tracks: SpotifyTrack[];
  /** True when the source could only expose the first page (embed fallback, 100 items). */
  truncated: boolean;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const EMBED_PAGE_LIMIT = 100;
const API = "https://api.spotify.com/v1";

export function isSpotifyApiConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

/**
 * Read the tracklist behind a Spotify link. Uses the Web API when client
 * credentials are configured (full playlists, per-track cover art); otherwise
 * falls back to the public embed page, which needs no account but only
 * exposes the first 100 tracks of a playlist.
 */
export async function fetchSpotifyTracklist(rawUrl: string, signal?: AbortSignal): Promise<SpotifyTracklist> {
  const ref = parseSpotifyUrl(rawUrl);
  if (!ref) throw new AppError("SPOTIFY_INVALID_URL");
  const list = isSpotifyApiConfigured() ? await viaApi(ref, signal) : await viaEmbed(ref, signal);
  if (list.tracks.length === 0) throw new AppError("SPOTIFY_UNAVAILABLE");
  return list;
}

// ---------- Web API (client credentials) ----------

const store = globalThis as unknown as { __spotifyToken?: { value: string; expiresAt: number } };

async function apiToken(signal?: AbortSignal): Promise<string> {
  const cached = store.__spotifyToken;
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.value;
  const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal,
  });
  if (!res.ok) throw new AppError("SPOTIFY_UNAVAILABLE", "Spotify API credentials were rejected.");
  const data = (await res.json()) as { access_token: string; expires_in: number };
  store.__spotifyToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = await apiToken(signal);
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (res.status === 404) throw new AppError("SPOTIFY_UNAVAILABLE", "This Spotify link does not exist or is private.");
  if (!res.ok) throw new AppError("SPOTIFY_UNAVAILABLE", `Spotify API error (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

interface ApiImage { url: string; width?: number }
interface ApiTrack {
  name: string;
  artists: { name: string }[];
  duration_ms: number;
  album?: { images?: ApiImage[] };
}
interface ApiPage<T> { items: T[]; next: string | null }

const smallestImage = (images?: ApiImage[]) =>
  images?.length ? [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0].url : undefined;

const fromApiTrack = (t: ApiTrack, fallbackCover?: string): SpotifyTrack => ({
  title: t.name,
  artist: t.artists.map((a) => a.name).join(", "),
  durationMs: t.duration_ms,
  coverUrl: smallestImage(t.album?.images) ?? fallbackCover,
});

async function apiPages<T>(firstPath: string, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  let path: string | null = firstPath;
  while (path) {
    const page: ApiPage<T> = await apiGet<ApiPage<T>>(path, signal);
    items.push(...page.items);
    path = page.next ? page.next.replace(API, "") : null;
  }
  return items;
}

async function viaApi(ref: SpotifyRef, signal?: AbortSignal): Promise<SpotifyTracklist> {
  if (ref.type === "track") {
    const t = await apiGet<ApiTrack>(`/tracks/${ref.id}`, signal);
    const track = fromApiTrack(t);
    return { ref, title: `${track.artist} - ${track.title}`, coverUrl: track.coverUrl, tracks: [track], truncated: false };
  }
  if (ref.type === "album") {
    const album = await apiGet<{ name: string; artists: { name: string }[]; images?: ApiImage[] }>(`/albums/${ref.id}`, signal);
    const cover = smallestImage(album.images);
    const items = await apiPages<ApiTrack>(`/albums/${ref.id}/tracks?limit=50`, signal);
    return {
      ref,
      title: `${album.artists.map((a) => a.name).join(", ")} - ${album.name}`,
      coverUrl: cover,
      tracks: items.map((t) => fromApiTrack(t, cover)),
      truncated: false,
    };
  }
  const playlist = await apiGet<{ name: string; images?: ApiImage[] }>(`/playlists/${ref.id}?fields=name,images`, signal);
  const items = await apiPages<{ track: ApiTrack | null }>(
    `/playlists/${ref.id}/tracks?limit=100&fields=next,items(track(name,artists(name),duration_ms,album(images)))`,
    signal,
  );
  return {
    ref,
    title: playlist.name,
    coverUrl: smallestImage(playlist.images),
    // Local files and removed songs come back as null tracks.
    tracks: items.flatMap((i) => (i.track?.name ? [fromApiTrack(i.track)] : [])),
    truncated: false,
  };
}

// ---------- Embed page fallback (no credentials) ----------

interface EmbedEntity {
  name?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  coverArt?: { sources?: { url: string; width?: number }[] };
  trackList?: { title?: string; subtitle?: string; duration?: number }[];
}

async function viaEmbed(ref: SpotifyRef, signal?: AbortSignal): Promise<SpotifyTracklist> {
  const res = await fetch(`https://open.spotify.com/embed/${ref.type}/${ref.id}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en" },
    signal,
  });
  if (!res.ok) throw new AppError("SPOTIFY_UNAVAILABLE", `Spotify returned HTTP ${res.status}.`);
  const html = await res.text();
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  let entity: EmbedEntity | undefined;
  try {
    entity = json
      ? (JSON.parse(json) as { props?: { pageProps?: { state?: { data?: { entity?: EmbedEntity } } } } })
          .props?.pageProps?.state?.data?.entity
      : undefined;
  } catch {
    entity = undefined;
  }
  if (!entity) throw new AppError("SPOTIFY_UNAVAILABLE");

  const cover = entity.coverArt?.sources?.length
    ? [...entity.coverArt.sources].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0].url
    : undefined;
  const rows = entity.trackList?.length
    ? entity.trackList
    : ref.type === "track"
      ? [{ title: entity.title ?? entity.name, subtitle: entity.subtitle, duration: entity.duration }]
      : [];
  const tracks: SpotifyTrack[] = rows.flatMap((t) =>
    t.title ? [{ title: t.title, artist: t.subtitle ?? "", durationMs: t.duration ?? 0, coverUrl: cover }] : [],
  );
  const title =
    ref.type === "track"
      ? `${tracks[0]?.artist ?? ""} - ${tracks[0]?.title ?? ""}`.replace(/^ - /, "")
      : entity.name ?? entity.title ?? "Spotify";
  return {
    ref,
    title,
    coverUrl: cover,
    tracks,
    truncated: ref.type === "playlist" && tracks.length >= EMBED_PAGE_LIMIT,
  };
}
