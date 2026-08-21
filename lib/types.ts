// ---------- Shared types (used by both server and client) ----------

export type JobType = "scan" | "download" | "djpool";

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
  | "cancelled";

export type DownloadFormat = "mp3" | "m4a" | "original" | "wav";

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
  sampleDuration: 10,
  smartScan: true,
  mergeWindow: 120,
  useShazam: true,
  useAcrCloud: true,
  keepTempFiles: false,
};

export interface DownloadSettings {
  /** MP3 bitrate in kbps */
  mp3Quality: number;
  keepTempFiles: boolean;
}

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  mp3Quality: 320,
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

export interface DownloadState {
  url: string;
  format: DownloadFormat;
  info?: MediaInfo;
  /** 0-100 */
  percent: number;
  /** e.g. "1.24MiB/s" */
  speed?: string;
  eta?: string;
  fileName?: string;
  fileSize?: number;
  statusText?: string;
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

export interface DjPoolTrack {
  id: string;
  /** Search query sent to the pool. */
  query: string;
  title: string;
  artist: string;
  status: DjPoolTrackStatus;
  /** Chosen best candidate. */
  best?: DjPoolCandidate;
  /** All ranked candidates (top few), for manual override in the UI. */
  candidates?: DjPoolCandidate[];
  fileName?: string;
  fileSize?: number;
  error?: string;
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
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: number;
  error?: string;
  scan?: ScanState;
  download?: DownloadState;
  djpool?: DjPoolState;
}
