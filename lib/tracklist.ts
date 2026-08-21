import type { TrackEntry } from "@/lib/types";

// ---------- Normalization & dedupe (pure — usable on server and client) ----------

/**
 * Normalize a title/artist for comparison: lowercase, strip ALL parenthetical
 * and bracketed decorations (feat/remix/radio edit/…), then punctuation.
 * Falls back to plain normalization when stripping would leave nothing.
 */
export function normalizeText(text: string): string {
  const lower = text.toLowerCase().normalize("NFKC");
  const stripped = lower
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b(feat|ft|prod)\.?\s.*$/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped) return stripped;
  return lower.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * First credited artist only, so "A feat. B", "A, B & C" and "A" all compare
 * equal. Recognition services format collaborator lists inconsistently.
 */
export function primaryArtist(artist: string): string {
  const first = artist.split(/,|&|×|\/|\bfeat\.?\s|\bft\.?\s|\bwith\s/i)[0];
  return normalizeText(first) || normalizeText(artist);
}

/** Cleaned-up display form: trim + collapse whitespace (keeps original casing). */
export function normalizeDisplay(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Identity key for duplicate detection. */
export function trackKey(title: string, artist: string): string {
  return `${normalizeText(title)}::${primaryArtist(artist)}`;
}

/**
 * Live merge decision: should a new detection be merged into the previous
 * track entry? Same song + close enough in time (mergeWindow) + same file.
 */
export function shouldMerge(
  prev: TrackEntry | undefined,
  title: string,
  artist: string,
  timestamp: number,
  fileIndex: number,
  mergeWindowSec: number,
): boolean {
  if (!prev) return false;
  if (prev.fileIndex !== fileIndex) return false;
  if (trackKey(prev.title, prev.artist) !== trackKey(title, artist)) return false;
  return timestamp - prev.lastSeen <= mergeWindowSec;
}

/**
 * Merge tracklists from repeated scans of the same source ("Rescan & Merge").
 * An incoming track is added unless the base already contains the same song
 * whose detected span (first seen → last seen, padded by mergeWindowSec)
 * covers its position. Result keeps file order then time order.
 */
export function mergeTracklists(
  base: TrackEntry[],
  incoming: TrackEntry[],
  mergeWindowSec: number,
): TrackEntry[] {
  const out = base.map((t) => ({ ...t }));
  for (const track of incoming) {
    const key = trackKey(track.title, track.artist);
    const dup = out.find(
      (b) =>
        b.fileIndex === track.fileIndex &&
        trackKey(b.title, b.artist) === key &&
        track.timestamp >= b.timestamp - mergeWindowSec &&
        track.timestamp <= b.lastSeen + mergeWindowSec,
    );
    if (dup) {
      // Same song seen in both rounds: widen the span to the union so the
      // cleaning pass has accurate timing to work with.
      dup.timestamp = Math.min(dup.timestamp, track.timestamp);
      dup.lastSeen = Math.max(dup.lastSeen, track.lastSeen);
    } else {
      out.push(track);
    }
  }
  return out.sort((a, b) => a.fileIndex - b.fileIndex || a.timestamp - b.timestamp);
}

export interface CleanOptions {
  /** Remove duplicate songs across the whole list (not only consecutive). */
  removeDuplicates: boolean;
}

/**
 * Recognition providers often name the same song differently (Thai vs English
 * title, artist aliases like "Knomjean" vs "ขนมจีน"). That shows up as an
 * A, B, A sandwich in the raw list: the alias B sits inside the time span of
 * the real song A. Cleaning therefore runs three passes:
 *
 *  1. re-merge same-song entries whose detected spans (nearly) touch — this
 *     re-joins the two halves of A that the alias split apart,
 *  2. drop single-detection "blips" that sit fully inside another song's
 *     span (the alias / one-off misrecognition B),
 *  3. normalize display text and (optionally) drop repeats across the list.
 */
export function cleanTracklist(tracks: TrackEntry[], opts: CleanOptions = { removeDuplicates: true }): TrackEntry[] {
  const sorted = [...tracks].sort(
    (a, b) => a.fileIndex - b.fileIndex || a.timestamp - b.timestamp,
  );

  // Pass 1: merge split spans of the same song (gap up to 3 minutes).
  const SPAN_GAP_SEC = 180;
  const merged: TrackEntry[] = [];
  for (const track of sorted) {
    const key = trackKey(track.title, track.artist);
    const prev = merged.find(
      (m) =>
        m.fileIndex === track.fileIndex &&
        trackKey(m.title, m.artist) === key &&
        track.timestamp >= m.timestamp &&
        track.timestamp - m.lastSeen <= SPAN_GAP_SEC,
    );
    if (prev) {
      prev.lastSeen = Math.max(prev.lastSeen, track.lastSeen);
      continue;
    }
    merged.push({ ...track });
  }

  // Pass 2: drop one-sample blips sandwiched inside another song's span.
  const survivors = merged.filter((track) => {
    const isBlip = track.lastSeen - track.timestamp <= 0;
    if (!isBlip) return true;
    return !merged.some(
      (other) =>
        other !== track &&
        other.fileIndex === track.fileIndex &&
        track.timestamp > other.timestamp &&
        track.timestamp < other.lastSeen,
    );
  });

  // Pass 3: display normalization + optional global dedupe.
  const seen = new Set<string>();
  const result: TrackEntry[] = [];
  for (const track of survivors) {
    const key = trackKey(track.title, track.artist);
    if (opts.removeDuplicates) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    result.push({
      ...track,
      title: normalizeDisplay(track.title),
      artist: normalizeDisplay(track.artist),
    });
  }
  return result;
}

// ---------- Formatting ----------

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

// ---------- Export ----------

export interface ExportOptions {
  includeTimestamps: boolean;
  includeArtist: boolean;
  includeFilename: boolean;
  removeDuplicates: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeTimestamps: true,
  includeArtist: true,
  includeFilename: false,
  removeDuplicates: true,
};

function prepare(tracks: TrackEntry[], opts: ExportOptions): TrackEntry[] {
  return opts.removeDuplicates ? cleanTracklist(tracks) : cleanTracklist(tracks, { removeDuplicates: false });
}

export function exportTxt(tracks: TrackEntry[], opts: ExportOptions): string {
  return prepare(tracks, opts)
    .map((t) => {
      const parts: string[] = [];
      if (opts.includeTimestamps) parts.push(formatTimestamp(t.timestamp));
      if (opts.includeArtist) parts.push(t.artist);
      parts.push(t.title);
      if (opts.includeFilename) parts.push(t.file);
      return parts.join(" - ");
    })
    .join("\n");
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function exportCsv(tracks: TrackEntry[], opts: ExportOptions): string {
  const header: string[] = ["#"];
  if (opts.includeTimestamps) header.push("Timestamp");
  header.push("Song");
  if (opts.includeArtist) header.push("Artist");
  if (opts.includeFilename) header.push("File");
  header.push("Recognition");

  const rows = prepare(tracks, opts).map((t, i) => {
    const row: string[] = [String(i + 1)];
    if (opts.includeTimestamps) row.push(formatTimestamp(t.timestamp));
    row.push(csvEscape(t.title));
    if (opts.includeArtist) row.push(csvEscape(t.artist));
    if (opts.includeFilename) row.push(csvEscape(t.file));
    row.push(t.provider);
    return row.join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

export function exportJson(tracks: TrackEntry[], opts: ExportOptions): string {
  const items = prepare(tracks, opts).map((t, i) => ({
    index: i + 1,
    ...(opts.includeTimestamps ? { timestamp: formatTimestamp(t.timestamp), seconds: t.timestamp } : {}),
    title: t.title,
    ...(opts.includeArtist ? { artist: t.artist } : {}),
    ...(t.album ? { album: t.album } : {}),
    ...(opts.includeFilename ? { file: t.file } : {}),
    recognition: t.provider,
  }));
  return JSON.stringify(items, null, 2);
}
