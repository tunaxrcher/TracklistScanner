// ---------- Shared types (used by both server and client) ----------

export type JobType = "scan" | "djpool" | "djdl";

export type JobStatus =
  | "queued"
  | "preparing"
  | "downloading"
  | "sampling"
  | "recognizing"
  | "matching"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export type ScanMode = "url" | "file" | "folder";

export type RecognitionProvider = "shazam" | "acrcloud";

export interface TrackEntry {
  id: string;
  /** Seconds from the start of the file where the song was first detected */
  timestamp: number;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  provider: RecognitionProvider;
  /** File name, or "Online Source" for URL scans */
  file: string;
  /** Index of the file within a folder scan (0 for single sources) */
  fileIndex: number;
  /** Last position (seconds) at which this same song was still detected */
  lastSeen: number;
}

export interface ScanSettings {
  /** Seconds between sample positions */
  scanInterval: number;
  /** Seconds of audio sent to recognition per sample */
  sampleDuration: number;
  /** Adaptive sampling: widen interval while the same song keeps playing */
  smartScan: boolean;
  /** Merge repeated detections of the same song within this many seconds */
  mergeWindow: number;
  useShazam: boolean;
  useAcrCloud: boolean;
  keepTempFiles: boolean;
}

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  scanInterval: 30,
  // 12s is Shazam's sweet spot: verified empirically that marginal songs
  // (e.g. tempo-shifted tracks in DJ mixes) match at 12s but not at 10s/14s.
  sampleDuration: 12,
  smartScan: true,
  mergeWindow: 120,
  useShazam: true,
  useAcrCloud: true,
  keepTempFiles: false,
};

export interface MediaInfo {
  title?: string;
  thumbnail?: string;
  /** Seconds */
  duration?: number;
  uploader?: string;
}

export interface ScanState {
  mode: ScanMode;
  /** Original URL for url-scans — used to resume and to save Recent on the server. */
  sourceUrl?: string;
  currentFile?: string;
  fileIndex: number;
  totalFiles: number;
  /** Seconds into the current file */
  currentTimestamp: number;
  /** Seconds, duration of the current file */
  totalDuration: number;
  samplesScanned: number;
  totalSamples: number;
  /** Samples that could not be checked (rate limits / provider errors) */
  samplesFailed: number;
  /** 0-100 for the current file */
  fileProgress: number;
  /** 0-100 across all files */
  overallProgress: number;
  songsFound: number;
  tracks: TrackEntry[];
  info?: MediaInfo;
}

// ---------- DJ Pool download ----------

/** Which explicit/clean variant to prefer when both exist. */
export type VersionPreference = "clean" | "dirty" | "either";

export interface DjPoolPreferences {
  versionPreference: VersionPreference;
  /** Skip acapella-only files. */
  avoidAcapella: boolean;
  /** Skip instrumental-only files. */
  avoidInstrumental: boolean;
  /** Skip intro/outro edit variants, prefer the full track. */
  avoidIntroOutro: boolean;
  /** Skip remixes/reworks unless the detected title already asks for one. */
  avoidRemix: boolean;
}

export const DEFAULT_DJPOOL_PREFERENCES: DjPoolPreferences = {
  versionPreference: "either",
  avoidAcapella: true,
  avoidInstrumental: true,
  avoidIntroOutro: true,
  avoidRemix: true,
};

/** A single file result from the DJ Pool search index. */
export interface DjPoolCandidate {
  name: string;
  ext: string;
  size: string;
  mime: string;
  /** Direct authenticated download URL. */
  download: string;
  /** Preview/stream URL (unused server-side, kept for reference). */
  stream?: string;
  /** Matcher score (higher is better). */
  score: number;
  /** Short human-readable reasons the score was adjusted. */
  reasons: string[];
}

export type DjPoolTrackStatus =
  | "pending"
  | "searching"
  | "matched"
  | "downloading"
  | "downloaded"
  | "notfound"
  | "failed"
  | "skipped";

/** Where to look for detected tracks, and in which order. */
export interface SourcePrefs {
  djpool: boolean;
  youtube: boolean;
  /** Which source to try first when both are enabled. */
  priority: "djpool" | "youtube";
}

export const DEFAULT_SOURCE_PREFS: SourcePrefs = {
  djpool: true,
  youtube: true,
  priority: "djpool",
};

/** A specific version chosen in the picker, used as-is by Download All. */
export interface TrackPin {
  source: "djpool" | "youtube";
  /** DJ Pool download URL, or YouTube video URL. */
  url: string;
  /** File name to save as (DJ Pool candidates carry their own name). */
  name?: string;
}

export interface DjPoolTrack {
  id: string;
  /** TrackEntry.id from the tracklist — used to restore row state after refresh. */
  clientId?: string;
  /** Search query sent to the pool. */
  query: string;
  title: string;
  artist: string;
  /** 1-based position in the tracklist (used for the numbered file prefix). */
  num?: number;
  /** Which source the file actually came from. */
  source?: "djpool" | "youtube";
  status: DjPoolTrackStatus;
  /** Download progress 0-100 while status is "downloading". */
  progress?: number;
  /** Chosen best candidate. */
  best?: DjPoolCandidate;
  /** All ranked candidates (top few), for manual override in the UI. */
  candidates?: DjPoolCandidate[];
  fileName?: string;
  fileSize?: number;
  error?: string;
  /** Pinned version — kept so Pause → Continue uses the same file. */
  pin?: TrackPin;
}

/** A YouTube search result offered as a downloadable version. */
export interface YoutubeVersion {
  id: string;
  url: string;
  title: string;
  channel?: string;
  /** Seconds */
  duration?: number;
  thumbnail?: string;
}

export interface DjPoolState {
  total: number;
  processed: number;
  downloaded: number;
  notFound: number;
  failed: number;
  tracks: DjPoolTrack[];
  /** Name of the final bundle (single file or .zip). */
  bundleName?: string;
  bundleSize?: number;
  /** Snapshot so Download All can be resumed without the original scan tab. */
  sourceUrl?: string;
  sourceTitle?: string;
  clientTracks?: TrackEntry[];
  /** Stored so Pause → Continue can keep the same search settings. */
  preferences?: DjPoolPreferences;
  sources?: SourcePrefs;
}

// ---------- Download For DJ (YouTube → DJ-ready file) ----------

/**
 * Output format for DJ downloads. Source audio from YouTube is lossy
 * (~130-160 kbps Opus); WAV re-encodes nothing further and plays on any
 * CDJ, MP3 320 trades a hair of quality for small files with tags.
 */
export type DjDownloadFormat = "wav" | "mp3";

export interface DjDlState {
  url: string;
  format: DjDownloadFormat;
  info?: MediaInfo;
  /** 0-100 for the fetch phase. */
  downloadProgress: number;
  fileName?: string;
  fileSize?: number;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: number;
  error?: string;
  /** Signed-in account that started the job (missing on legacy in-memory jobs). */
  ownerEmail?: string;
  scan?: ScanState;
  djpool?: DjPoolState;
  djdl?: DjDlState;
}
