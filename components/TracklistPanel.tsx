"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  DownloadCloud,
  FileArchive,
  FileAudio,
  FolderOpen,
  Globe,
  Link2,
  ListMusic,
  Loader2,
  RotateCcw,
  ScanLine,
  Settings2,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useJob } from "@/lib/client/useJob";
import type { AppSettings } from "@/lib/client/settings";
import type {
  DjPoolCandidate,
  Job,
  ScanMode,
  ScanSettings,
  SourcePrefs,
  TrackEntry,
  YoutubeVersion,
} from "@/lib/types";
import type { PinnedVersion } from "@/components/TracklistGrid";
import { cleanTracklist, formatTimestamp, mergeTracklists } from "@/lib/tracklist";
import {
  djPoolStreamSrc,
  filenameFromResponse,
  readBlobWithProgress,
  rowStatusFromJob,
  saveBlob,
  youtubeStreamSrc,
  versionKey,
  type DjRowState,
} from "@/lib/client/djpool";
import { addRecent, type RecentItem } from "@/lib/client/recent";
import { loadSourcePrefs, saveSourcePrefs } from "@/lib/client/sources";
import { youtubeEmbed } from "@/lib/client/youtube";
import { ProgressBar, Stat, StatusBadge, formatBytes } from "@/components/ui";
import { TracklistGrid, type DjPoolColumn } from "@/components/TracklistGrid";
import { RecentRow } from "@/components/RecentRow";
import { PlayerBar, type NowPlaying } from "@/components/PlayerBar";
import { ExportDialog } from "@/components/ExportDialog";
import { SourceDialog } from "@/components/SourceDialog";

const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".webm"];
const ACCEPT = AUDIO_EXTENSIONS.join(",");

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function sameSource(a?: string | null, b?: string | null): boolean {
  return Boolean(a && b && a.trim() === b.trim());
}

/** Fire-and-forget: hide a finished job from /api/jobs/mine reconnects. */
function dismissJob(jobId: string): void {
  void fetch(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
}

/** Whether the in-memory Download All job belongs to the tracklist on screen. */
function bundleMatchesView(
  sourceUrl: string | undefined,
  clientTracks: { id: string }[] | undefined,
  viewingSource: string,
  displayIds: string[],
): boolean {
  if (sourceUrl) return sameSource(sourceUrl, viewingSource);
  if (!clientTracks?.length || displayIds.length === 0) return false;
  const ids = new Set(clientTracks.map((t) => t.id));
  let hit = 0;
  for (const id of displayIds) if (ids.has(id)) hit += 1;
  return hit >= Math.ceil(Math.min(displayIds.length, clientTracks.length) * 0.5);
}

const SOURCES: { id: ScanMode; name: string; description: string; icon: React.ReactNode }[] = [
  { id: "url", name: "URL", description: "YouTube / supported web URL", icon: <Globe size={20} /> },
  { id: "file", name: "Audio File", description: "Scan one local audio file", icon: <FileAudio size={20} /> },
  { id: "folder", name: "Folder", description: "Scan many audio files", icon: <FolderOpen size={20} /> },
];

type ScanPreset = "fast" | "thorough" | "custom";

const PRESETS: { id: ScanPreset; name: string; description: string }[] = [
  { id: "thorough", name: "Thorough", description: "DJ mixes, fast song changes · Smart OFF · 20s" },
  { id: "fast", name: "Fast", description: "Albums, podcasts, long plays · Smart ON · 30s" },
  { id: "custom", name: "Custom", description: "Use values from Settings" },
];

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
}

async function collectFromDirectory(handle: FileSystemDirectoryHandle): Promise<File[]> {
  const files: File[] = [];
  const dirHandle = handle as FileSystemDirectoryHandle & {
    values(): AsyncIterable<FileSystemHandle>;
  };
  for await (const entry of dirHandle.values()) {
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      if (isAudioFile(file.name)) files.push(file);
    }
  }
  return files;
}

export function TracklistPanel({
  settings,
  djPoolConfigured,
  acrConfigured,
}: {
  settings: AppSettings;
  djPoolConfigured: boolean | null;
  acrConfigured: boolean | null;
}) {
  const [mode, setMode] = useState<ScanMode>("url");
  const [preset, setPreset] = useState<ScanPreset>("thorough");
  const [modeOpen, setModeOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [cleaned, setCleaned] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { job, starting, error, start, attach, cancel, reset } = useJob();

  // Separate job stream for the "Download All" bundle.
  const djJob = useJob();
  const djAttach = djJob.attach;
  // Ordered track ids sent to the current bundle job, for index → id mapping.
  const djJobTrackIds = useRef<string[]>([]);
  // After Stop, continue copies files from this cancelled job instead of restarting.
  const [resumeFromJobId, setResumeFromJobId] = useState<string | null>(null);

  // Reconnect to a scan / Download All that kept running after this tab closed.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/jobs/mine")
      .then((r) => (r.ok ? (r.json() as Promise<{ scan?: Job | null; djpool?: Job | null }>) : null))
      .then((data) => {
        if (cancelled || !data) return;

        if (data.scan) {
          if (data.scan.scan?.sourceUrl) {
            setMode("url");
            setUrl(data.scan.scan.sourceUrl);
          } else if (data.scan.scan?.mode) {
            setMode(data.scan.scan.mode);
          }
          attach(data.scan.id);
        }

        const bundle = data.djpool;
        const snap = bundle?.djpool;
        if (!bundle || !snap) return;
        const terminal = ["completed", "failed", "cancelled", "paused"].includes(bundle.status);
        const scanUrl = data.scan?.scan?.sourceUrl;
        const sameSource = Boolean(snap.sourceUrl && scanUrl && snap.sourceUrl === scanUrl);

        const restoreListIfNeeded = () => {
          if (!data.scan && snap.clientTracks && snap.clientTracks.length > 0) {
            setRestored({
              url: snap.sourceUrl || "bundle",
              title: snap.sourceTitle,
              tracks: snap.clientTracks,
            });
            setCleaned(true);
            if (snap.sourceUrl) {
              setMode("url");
              setUrl(snap.sourceUrl);
            }
          }
        };

        if (bundle.status === "paused") {
          if (data.scan && !sameSource) return;
          restoreListIfNeeded();
          const ids = snap.tracks.map((t) => t.clientId).filter((id): id is string => Boolean(id));
          if (ids.length) djJobTrackIds.current = ids;
          djAttach(bundle.id);
          return;
        }

        // Stopped mid-bundle: keep Saved rows so Continue can skip them.
        if (bundle.status === "cancelled" && (snap.downloaded ?? 0) > 0) {
          if (data.scan && !sameSource) return;
          restoreListIfNeeded();
          setDjRows((prev) => {
            const next = { ...prev };
            for (const t of snap.tracks) {
              if (!t.clientId || t.status !== "downloaded") continue;
              next[t.clientId] = { status: "done", fileName: t.fileName };
            }
            return next;
          });
          setResumeFromJobId(bundle.id);
          return;
        }

        // Failed bundles are leftover — don't bring Redo-style state back.
        if (terminal && bundle.status !== "completed") return;
        if (terminal && !sameSource && data.scan) return;

        const ids = snap.tracks.map((t) => t.clientId).filter((id): id is string => Boolean(id));
        if (ids.length) djJobTrackIds.current = ids;
        restoreListIfNeeded();
        djAttach(bundle.id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [attach, djAttach]);
  const [djRows, setDjRows] = useState<Record<string, DjRowState>>({});
  const [picker, setPicker] = useState<{
    trackId: string | null;
    loading: boolean;
    candidates: DjPoolCandidate[];
    /** Whether the pool candidates are a verified same-song match. */
    matched: boolean;
    error?: string;
    youtube: { loading: boolean; results: YoutubeVersion[]; error?: string };
  }>({
    trackId: null,
    loading: false,
    candidates: [],
    matched: false,
    youtube: { loading: false, results: [] },
  });

  // Where tracks are searched/downloaded from (DJ Pool / YouTube / both).
  const initialSources = useMemo(loadSourcePrefs, []);
  const [sourcePrefs, setSourcePrefs] = useState<SourcePrefs>(initialSources.prefs);
  // "Chosen" for this session — remembered choices skip the dialog entirely.
  const [sourcesChosen, setSourcesChosen] = useState(initialSources.remembered);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  // Candidates discovered during the availability probe, reused by Get/picker/play.
  const [djCandidates, setDjCandidates] = useState<Record<string, DjPoolCandidate[]>>({});
  // Tracks unchecked by the user — excluded from Download All (absent = included).
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // Specific versions pinned from the picker, used by Get and Download All.
  const [pins, setPins] = useState<Record<string, PinnedVersion>>({});
  // Which scan job id has already been probed against DJ Pool.
  const probedJobId = useRef<string | null>(null);
  // Bottom player (DJ Pool preview).
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  // Tracklist restored from a Recent item (no live job behind it).
  const [restored, setRestored] = useState<{ url: string; title?: string; tracks: TrackEntry[] } | null>(null);
  // Accumulated tracks from previous rounds when using "Rescan & Merge".
  const [baseTracks, setBaseTracks] = useState<TrackEntry[] | null>(null);
  const [mergeRounds, setMergeRounds] = useState(0);

  const scan = job?.scan;
  const running = job != null && !["completed", "failed", "cancelled"].includes(job.status);
  // A stopped scan keeps its partial tracklist, so treat any ended job with
  // tracks as "done" — DJ Pool tools and the probe work on partial results too.
  const done = job != null && !running;
  // DJ Pool tools are active for a finished scan or a restored Recent result.
  const resultsReady = done || (!job && restored != null);
  const sourceTracks = useMemo(() => {
    const current = scan?.tracks ?? restored?.tracks ?? [];
    if (!baseTracks) return current;
    return mergeTracklists(baseTracks, scan?.tracks ?? [], settings.scan.mergeWindow);
  }, [scan?.tracks, restored?.tracks, baseTracks, settings.scan.mergeWindow]);
  const hasTracks = sourceTracks.length > 0;

  // Auto-enable Clean once a scan finishes (adjust-state-during-render):
  // the raw list often carries provider-alias duplicates and one-off blips,
  // so the cleaned view is the better default. Users can still toggle it off.
  const [wasDone, setWasDone] = useState(false);
  if (done !== wasDone) {
    setWasDone(done);
    if (done) setCleaned(true);
  }

  const displayTracks: TrackEntry[] = useMemo(
    () => (cleaned ? cleanTracklist(sourceTracks) : sourceTracks),
    [sourceTracks, cleaned],
  );

  const djState = djJob.job?.djpool;
  const djRunning =
    djJob.job != null && !["completed", "failed", "cancelled", "paused"].includes(djJob.job.status);
  const djPaused = djJob.job?.status === "paused";
  const viewingSource = restored?.url || url.trim();
  const bundleBelongsHere = Boolean(
    djState &&
      bundleMatchesView(
        djState.sourceUrl,
        djState.clientTracks,
        viewingSource,
        displayTracks.map((t) => t.id),
      ),
  );
  const djOnThisList = djRunning && bundleBelongsHere && hasTracks;
  const djCompleted = djJob.job?.status === "completed" && bundleBelongsHere;
  const djBundling = djJob.job?.status === "processing";
  const djCurrent = djState?.tracks.find(
    (t) => t.status === "downloading" || t.status === "searching" || t.status === "matched",
  );

  // Merge live bundle-job state into per-row state (index-aligned).
  useEffect(() => {
    if (!djState || !bundleBelongsHere) return;
    setDjRows((prev) => {
      const next = { ...prev };
      djState.tracks.forEach((jt, i) => {
        const id = jt.clientId || djJobTrackIds.current[i];
        if (!id) return;
        djJobTrackIds.current[i] = id;
        // Queued tracks stay as they were (Get / available) — only the
        // active song should flip to Finding / downloading.
        if (jt.status === "pending") return;
        const prevRow = next[id];
        // After Pause, the interrupted song is not "in progress" anymore.
        if (
          djPaused &&
          (jt.status === "searching" || jt.status === "downloading" || jt.status === "matched")
        ) {
          if (prevRow?.status === "done") return;
          next[id] = { status: "available", fileName: prevRow?.fileName, savedKey: prevRow?.savedKey };
          return;
        }
        const status = rowStatusFromJob(jt.status);
        // Don't let a pin made *after* Saved rewrite savedKey — that would
        // hide Get for the version the user just chose.
        const savedKey =
          status === "done"
            ? prevRow?.status === "done"
              ? prevRow.savedKey
              : pins[id]
                ? versionKey(pins[id].source, pins[id].url)
                : versionKey(jt.source ?? "djpool", jt.best?.download)
            : prevRow?.savedKey;
        next[id] = {
          status,
          fileName: jt.fileName ?? prevRow?.fileName,
          error: jt.error,
          progress: jt.progress,
          savedKey,
        };
      });
      return next;
    });
  }, [djState, pins, bundleBelongsHere, djPaused]);

  const playBest = useCallback(
    (track: TrackEntry) => {
      const best = djCandidates[track.id]?.[0];
      if (!best) return;
      setNowPlaying((cur) =>
        cur?.trackId === track.id
          ? null
          : {
              trackId: track.id,
              name: best.name,
              subtitle: `${track.artist} · ${track.title}`,
              cover: track.coverUrl,
              src: djPoolStreamSrc(best),
            },
      );
    },
    [djCandidates],
  );

  /** Preview a specific pool candidate; pressing the playing one stops it. */
  const playCandidate = useCallback((track: TrackEntry, candidate: DjPoolCandidate) => {
    const src = djPoolStreamSrc(candidate);
    setNowPlaying((cur) =>
      cur?.src === src
        ? null
        : {
            trackId: track.id,
            name: candidate.name,
            subtitle: `${track.artist} · ${track.title}`,
            cover: track.coverUrl,
            src,
          },
    );
  }, []);

  const canPlay = useCallback(
    (track: TrackEntry) => (djCandidates[track.id]?.length ?? 0) > 0,
    [djCandidates],
  );

  /** Preview a YouTube result from the picker (streams audio, nothing saved). */
  const playYoutube = useCallback((track: TrackEntry, video: YoutubeVersion) => {
    const src = youtubeStreamSrc(video.url);
    setNowPlaying((cur) =>
      cur?.src === src
        ? null
        : {
            trackId: track.id,
            name: video.title,
            subtitle: `YouTube preview · ${video.channel ?? ""}`,
            cover: video.thumbnail ?? track.coverUrl,
            src,
          },
    );
  }, []);

  /** "01 - " style prefix from the track's position in the displayed list. */
  const trackNumPrefix = useCallback(
    (track: TrackEntry) => {
      const i = displayTracks.findIndex((t) => t.id === track.id);
      return i >= 0 ? `${String(i + 1).padStart(2, "0")} - ` : "";
    },
    [displayTracks],
  );

  const closePicker = useCallback(
    () =>
      setPicker({
        trackId: null,
        loading: false,
        candidates: [],
        matched: false,
        youtube: { loading: false, results: [] },
      }),
    [],
  );

  /**
   * Download a track from YouTube (specific video from the picker, a pinned
   * video, or the top search result). The server converts it to MP3 320.
   */
  const downloadYoutube = useCallback(
    async (track: TrackEntry, video?: { url: string }) => {
      closePicker();
      const pin = pins[track.id];
      const target = video ?? (pin?.source === "youtube" ? { url: pin.url } : undefined);
      setDjRows((r) => ({ ...r, [track.id]: { status: "searching" } }));
      try {
        const baseName = `${trackNumPrefix(track)}${track.artist ? `${track.artist} - ` : ""}${track.title}`;
        const res = await fetch("/api/youtube/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            target
              ? { url: target.url, format: "mp3", baseName }
              : { title: track.title, artist: track.artist, format: "mp3", baseName },
          ),
        });
        if (res.status === 404) {
          setDjRows((r) => ({ ...r, [track.id]: { status: "notfound" } }));
          return;
        }
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error ?? "Download failed.");
        }
        setDjRows((r) => ({ ...r, [track.id]: { status: "downloading" } }));
        const blob = await readBlobWithProgress(res, (progress) =>
          setDjRows((r) => ({ ...r, [track.id]: { status: "downloading", progress } })),
        );
        const name = filenameFromResponse(res, `${baseName}.mp3`);
        saveBlob(blob, name);
        setDjRows((r) => ({
          ...r,
          [track.id]: { status: "done", fileName: name, savedKey: versionKey("youtube", target?.url) },
        }));
      } catch (err) {
        setDjRows((r) => ({ ...r, [track.id]: { status: "failed", error: (err as Error).message } }));
      }
    },
    [closePicker, trackNumPrefix, pins],
  );

  const downloadBest = useCallback(
    async (track: TrackEntry) => {
      const pin = pins[track.id];
      // A pinned YouTube video takes the YouTube path entirely.
      if (pin?.source === "youtube") return downloadYoutube(track);

      // Pinned pool version, or a candidate already found by the probe,
      // skips the second search.
      const cachedBest = djCandidates[track.id]?.[0];
      const direct = pin?.source === "djpool" ? { downloadUrl: pin.url, name: pin.name } : null;
      setDjRows((r) => ({
        ...r,
        [track.id]: { status: direct || cachedBest ? "downloading" : "searching" },
      }));
      try {
        const payload =
          direct ??
          (cachedBest
            ? {
                downloadUrl: cachedBest.download,
                name: cachedBest.name.endsWith(`.${cachedBest.ext}`)
                  ? cachedBest.name
                  : `${cachedBest.name}.${cachedBest.ext}`,
              }
            : { title: track.title, artist: track.artist, preferences: settings.djpool });
        const res = await fetch("/api/djpool/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.status === 404) {
          setDjRows((r) => ({ ...r, [track.id]: { status: "notfound" } }));
          return;
        }
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error ?? "Download failed.");
        }
        setDjRows((r) => ({ ...r, [track.id]: { status: "downloading" } }));
        const blob = await readBlobWithProgress(res, (progress) =>
          setDjRows((r) => ({ ...r, [track.id]: { status: "downloading", progress } })),
        );
        const name =
          trackNumPrefix(track) + filenameFromResponse(res, `${track.artist} - ${track.title}.mp3`);
        saveBlob(blob, name);
        setDjRows((r) => ({
          ...r,
          [track.id]: {
            status: "done",
            fileName: name,
            savedKey: versionKey("djpool", direct?.downloadUrl ?? cachedBest?.download),
          },
        }));
      } catch (err) {
        setDjRows((r) => ({ ...r, [track.id]: { status: "failed", error: (err as Error).message } }));
      }
    },
    [settings.djpool, djCandidates, trackNumPrefix, pins, downloadYoutube],
  );

  const openPicker = useCallback(
    async (track: TrackEntry) => {
      const poolEnabled = sourcePrefs.djpool && djPoolConfigured !== false;
      const ytEnabled = sourcePrefs.youtube;
      const cached = djCandidates[track.id];
      const needPoolFetch = poolEnabled && (!cached || cached.length === 0);

      setPicker({
        trackId: track.id,
        loading: needPoolFetch,
        candidates: cached ?? [],
        // Cached candidates come from the availability probe, which only
        // stores verified same-song matches.
        matched: (cached?.length ?? 0) > 0,
        youtube: { loading: ytEnabled, results: [] },
      });

      if (needPoolFetch) {
        try {
          const res = await fetch("/api/djpool/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: track.title, artist: track.artist, preferences: settings.djpool }),
          });
          const data = (await res.json()) as {
            candidates?: DjPoolCandidate[];
            matched?: boolean;
            error?: string;
          };
          if (!res.ok) throw new Error(data.error ?? "Search failed.");
          setPicker((p) =>
            p.trackId === track.id
              ? { ...p, loading: false, candidates: data.candidates ?? [], matched: data.matched === true }
              : p,
          );
        } catch (err) {
          setPicker((p) =>
            p.trackId === track.id ? { ...p, loading: false, error: (err as Error).message } : p,
          );
        }
      }

      if (ytEnabled) {
        try {
          const res = await fetch("/api/youtube/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: track.title, artist: track.artist }),
          });
          const data = (await res.json()) as { results?: YoutubeVersion[]; error?: string };
          if (!res.ok) throw new Error(data.error ?? "Search failed.");
          setPicker((p) =>
            p.trackId === track.id
              ? { ...p, youtube: { loading: false, results: data.results ?? [] } }
              : p,
          );
        } catch (err) {
          setPicker((p) =>
            p.trackId === track.id
              ? { ...p, youtube: { loading: false, results: [], error: (err as Error).message } }
              : p,
          );
        }
      }
    },
    [settings.djpool, djCandidates, sourcePrefs, djPoolConfigured],
  );

  const pickVersion = useCallback(
    async (track: TrackEntry, candidate: DjPoolCandidate) => {
      closePicker();
      setDjRows((r) => ({ ...r, [track.id]: { status: "downloading" } }));
      try {
        const fallback = candidate.name.endsWith(`.${candidate.ext}`)
          ? candidate.name
          : `${candidate.name}.${candidate.ext}`;
        const res = await fetch("/api/djpool/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ downloadUrl: candidate.download, name: fallback }),
        });
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error ?? "Download failed.");
        }
        const blob = await readBlobWithProgress(res, (progress) =>
          setDjRows((r) => ({ ...r, [track.id]: { status: "downloading", progress } })),
        );
        const name = trackNumPrefix(track) + filenameFromResponse(res, fallback);
        saveBlob(blob, name);
        setDjRows((r) => ({
          ...r,
          [track.id]: { status: "done", fileName: name, savedKey: versionKey("djpool", candidate.download) },
        }));
      } catch (err) {
        setDjRows((r) => ({ ...r, [track.id]: { status: "failed", error: (err as Error).message } }));
      }
    },
    [closePicker, trackNumPrefix],
  );

  // Tracks the bundle download will actually attempt, with their 1-based
  // tracklist positions (for the "01 - " filename prefix). Unchecked rows are
  // skipped; pinned rows are always obtainable; with YouTube enabled every
  // track is obtainable; otherwise pool "Not found" rows are excluded.
  const downloadableTracks = useMemo(
    () =>
      displayTracks
        .map((track, i) => ({ track, num: i + 1 }))
        .filter(({ track }) => selected[track.id] !== false)
        .filter(({ track }) => {
          if (pins[track.id] != null || sourcePrefs.youtube) return true;
          const status = djRows[track.id]?.status;
          // idle/checking = probe not finished — don't pretend they're downloadable
          return status === "available" || status === "done" || status === "downloading";
        }),
    [displayTracks, djRows, sourcePrefs.youtube, selected, pins],
  );

  const remainingTracks = useMemo(
    () => downloadableTracks.filter(({ track }) => djRows[track.id]?.status !== "done"),
    [downloadableTracks, djRows],
  );
  const continueCount =
    djState?.tracks.filter(
      (t) =>
        t.status === "pending" ||
        t.status === "searching" ||
        t.status === "downloading" ||
        t.status === "matched",
    ).length ?? remainingTracks.length;
  const canContinue = Boolean(djPaused && bundleBelongsHere && continueCount > 0);

  const downloadAll = useCallback(() => {
    if (djPaused && djJob.job?.id) {
      void fetch(`/api/jobs/${djJob.job.id}/resume`, { method: "POST" });
      return;
    }
    const list = downloadableTracks;
    if (list.length === 0) return;
    djJobTrackIds.current = list.map(({ track }) => track.id);
    closePicker();
    void djJob.start(() =>
      fetch("/api/jobs/djpool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: list.map(({ track, num }) => {
            const pin = pins[track.id];
            return {
              id: track.id,
              title: track.title,
              artist: track.artist,
              num,
              pin: pin ? { source: pin.source, url: pin.url, name: pin.name } : undefined,
            };
          }),
          preferences: settings.djpool,
          sources: sourcePrefs,
          sourceUrl: url.trim() || restored?.url,
          sourceTitle: scan?.info?.title ?? restored?.title,
          clientTracks: displayTracks,
        }),
      }),
    );
  }, [
    djPaused,
    downloadableTracks,
    djJob,
    settings.djpool,
    sourcePrefs,
    pins,
    url,
    restored,
    scan,
    displayTracks,
    closePicker,
  ]);

  /** Pause the bundle. Saved files stay on the same job so Continue skips them. */
  const stopBundle = useCallback(async () => {
    await djJob.pause();
    setDjRows((prev) => {
      const next = { ...prev };
      for (const [id, row] of Object.entries(next)) {
        if (row.status === "searching" || row.status === "downloading") {
          next[id] = { status: "available" };
        }
      }
      return next;
    });
  }, [djJob]);

  // Auto-probe DJ Pool availability once results are ready (scan completed or
  // stopped, or a Recent tracklist restored), so each row shows "Not found" or
  // a ready Get button without clicking first.
  const probeKey = done && job ? job.id : !job && restored ? `recent:${restored.url}` : null;
  useEffect(() => {
    // Probing only makes sense once the user has picked sources, and only
    // when DJ Pool is one of them (YouTube has everything, nothing to probe).
    if (!probeKey || !sourcesChosen || !sourcePrefs.djpool || djPoolConfigured === false) return;
    // When YouTube is tried first, every track is covered by YouTube anyway —
    // pool availability is irrelevant noise ("not on pool" badges), so skip
    // the probe entirely. Pool candidates still load in the picker on demand.
    if (sourcePrefs.youtube && sourcePrefs.priority === "youtube") return;
    const tracks = sourceTracks;
    if (tracks.length === 0) return;
    // Skip only after a probe of this tracklist actually finished. The guard
    // is set at the end (not the start) so a cancelled in-flight run — React
    // Strict Mode remount, source change — can start again instead of leaving
    // every row stuck on a blank "Get".
    if (probedJobId.current === probeKey) return;

    let cancelled = false;

    // Search each distinct song only once, then apply to all its rows.
    const groups = new Map<string, { title: string; artist: string; ids: string[] }>();
    for (const t of tracks) {
      const key = `${t.title.toLowerCase().trim()}|||${t.artist.toLowerCase().trim()}`;
      const g = groups.get(key);
      if (g) g.ids.push(t.id);
      else groups.set(key, { title: t.title, artist: t.artist, ids: [t.id] });
    }

    setDjRows((prev) => {
      const next = { ...prev };
      for (const t of tracks) {
        const cur = next[t.id]?.status;
        if (cur === "downloading" || cur === "done") continue; // keep user results
        next[t.id] = { status: "checking" };
      }
      return next;
    });

    const queue = [...groups.values()];
    const applyStatus = (ids: string[], status: DjRowState["status"]) =>
      setDjRows((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          const cur = next[id]?.status;
          if (cur === "downloading" || cur === "done") continue; // don't clobber user action
          next[id] = { status };
        }
        return next;
      });

    const worker = async () => {
      while (!cancelled) {
        const group = queue.shift();
        if (!group) return;
        try {
          const res = await fetch("/api/djpool/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: group.title, artist: group.artist, preferences: settings.djpool }),
          });
          const data = (await res.json()) as { candidates?: DjPoolCandidate[]; matched?: boolean };
          if (cancelled) return;
          // Only a strong match (same song, not just a title collision) counts
          // as available; loose candidates stay reachable via the picker.
          const candidates = res.ok && data.matched ? data.candidates ?? [] : [];
          if (candidates.length > 0) {
            setDjCandidates((prev) => {
              const next = { ...prev };
              for (const id of group.ids) next[id] = candidates;
              return next;
            });
            applyStatus(group.ids, "available");
          } else {
            applyStatus(group.ids, "notfound");
          }
        } catch {
          if (cancelled) return;
          // Network hiccup during probe: leave the row actionable.
          applyStatus(group.ids, "available");
        }
      }
    };

    const CONCURRENCY = 4;
    void Promise.all(Array.from({ length: CONCURRENCY }, () => worker())).then(() => {
      if (!cancelled) probedJobId.current = probeKey;
    });

    return () => {
      cancelled = true;
    };
  }, [
    probeKey,
    sourceTracks,
    djPoolConfigured,
    settings.djpool,
    sourcesChosen,
    sourcePrefs.djpool,
    sourcePrefs.youtube,
    sourcePrefs.priority,
  ]);

  /** Confirm handler for the source chooser dialog. */
  const onSourcesConfirm = (prefs: SourcePrefs, remember: boolean) => {
    const wouldProbe = (p: SourcePrefs) =>
      p.djpool && !(p.youtube && p.priority === "youtube");
    setSourcePrefs(prefs);
    setSourcesChosen(true);
    setSourceDialogOpen(false);
    saveSourcePrefs(prefs, remember);
    // Pool probe results ("Not found" / available) stay valid whenever DJ Pool
    // is still the source being probed. Wiping them on Continue — even when
    // only priority/YouTube flipped — left every row as a blank "Get" if the
    // effect decided it had already probed this tracklist.
    if (wouldProbe(sourcePrefs) && wouldProbe(prefs)) return;
    // Switching *into* a DJ Pool-first probe (YouTube-first → pool first, or
    // pool just turned on): drop stale idle rows so the probe can refill them.
    if (wouldProbe(prefs)) {
      setDjRows((prev) => {
        const next: typeof prev = {};
        for (const [id, row] of Object.entries(prev)) {
          next[id] = row.status === "done" || row.status === "downloading" ? row : { status: "idle" };
        }
        return next;
      });
      probedJobId.current = null;
    }
  };

  const djColumn: DjPoolColumn = {
    configured: djPoolConfigured,
    sources: sourcePrefs,
    rows: djRows,
    selected,
    onToggleSelect: (track) =>
      setSelected((s) => ({ ...s, [track.id]: s[track.id] === false })),
    pins,
    onPin: (track, pin) =>
      setPins((p) => {
        const next = { ...p };
        if (pin) next[track.id] = pin;
        else delete next[track.id];
        return next;
      }),
    picker,
    onDownload: downloadBest,
    onYoutubeGet: (track) => void downloadYoutube(track),
    onOpenPicker: openPicker,
    onClosePicker: closePicker,
    onPick: pickVersion,
    onPickYoutube: (track, video) => void downloadYoutube(track, video),
    canPlay,
    onPlay: playBest,
    onPlayCandidate: playCandidate,
    onPlayYoutube: playYoutube,
    playingSrc: nowPlaying?.src,
  };

  const anySourceUsable = (sourcePrefs.djpool && djPoolConfigured !== false) || sourcePrefs.youtube;
  const sourcesLabel =
    sourcePrefs.djpool && sourcePrefs.youtube
      ? sourcePrefs.priority === "djpool"
        ? "DJ Pool → YouTube"
        : "YouTube → DJ Pool"
      : sourcePrefs.djpool
        ? "DJ Pool"
        : "YouTube";

  /** Clear every result-related state (DJ Pool rows, bundle job, player, …).
   *  A Download All that is still running stays attached — New Scan must not
   *  kill it, so Recent / View can show progress again. */
  const clearResults = () => {
    if (djRunning || djPaused) {
      setDjRows({});
    } else {
      djJob.reset();
      djJobTrackIds.current = [];
      setResumeFromJobId(null);
      setDjRows({});
    }
    setDjCandidates({});
    setSelected({});
    setPins({});
    closePicker();
    setNowPlaying(null);
    setRestored(null);
    setBaseTracks(null);
    setMergeRounds(0);
    probedJobId.current = null;
    setCleaned(false);
  };

  /** Jump back to the tracklist that still has Download All running. */
  const returnToBundle = () => {
    const snap = djJob.job?.djpool;
    if (!snap) return;
    reset();
    setFiles([]);
    setDjRows({});
    setDjCandidates({});
    setSelected({});
    setPins({});
    closePicker();
    setNowPlaying(null);
    setBaseTracks(null);
    setMergeRounds(0);
    probedJobId.current = null;
    if (snap.clientTracks && snap.clientTracks.length > 0) {
      setRestored({
        url: snap.sourceUrl || "bundle",
        title: snap.sourceTitle,
        tracks: snap.clientTracks,
      });
      setCleaned(true);
    }
    if (snap.sourceUrl?.startsWith("file:")) {
      setUrl("");
    } else if (snap.sourceUrl) {
      setMode("url");
      setUrl(snap.sourceUrl);
    }
  };

  const resetAll = () => {
    // Tell the server we're done with the finished jobs, otherwise a refresh
    // reconnects to them via /api/jobs/mine and the result comes right back.
    if (job && !running) dismissJob(job.id);
    if (djJob.job && !djRunning && !djPaused) dismissJob(djJob.job.id);
    reset();
    clearResults();
    setFiles([]);
    setUrl("");
  };

  /** If Download All is still on the server but this tab dropped it, attach again. */
  const reconnectBundleFor = (sourceUrl: string) => {
    if (djRunning || djPaused) return;
    void fetch("/api/jobs/mine")
      .then((r) => (r.ok ? (r.json() as Promise<{ djpool?: Job | null }>) : null))
      .then((data) => {
        const bundle = data?.djpool;
        const snap = bundle?.djpool;
        if (!bundle || !snap) return;
        if (!sameSource(snap.sourceUrl, sourceUrl)) return;
        const running = !["completed", "failed", "cancelled"].includes(bundle.status);
        if (running || bundle.status === "paused") {
          const ids = snap.tracks.map((t) => t.clientId).filter((id): id is string => Boolean(id));
          if (ids.length) djJobTrackIds.current = ids;
          djAttach(bundle.id);
          return;
        }
        if (bundle.status === "cancelled" && (snap.downloaded ?? 0) > 0) {
          setDjRows((prev) => {
            const next = { ...prev };
            for (const t of snap.tracks) {
              if (!t.clientId || t.status !== "downloaded") continue;
              next[t.clientId] = { status: "done", fileName: t.fileName };
            }
            return next;
          });
          setResumeFromJobId(bundle.id);
        }
      })
      .catch(() => {});
  };

  // Clicking a Recent item restores its saved tracklist instantly;
  // URL items without saved tracks just prefill the URL for a fresh scan.
  const onSelectRecent = (item: RecentItem) => {
    if (running || starting) return;
    if (item.kind === "file" || item.kind === "folder") {
      if (!item.tracks || item.tracks.length === 0) return;
      resetAll();
      setRestored({ url: item.url, title: item.title, tracks: item.tracks });
      setCleaned(true);
      reconnectBundleFor(item.url);
      return;
    }
    resetAll();
    setMode("url");
    setUrl(item.url);
    if (item.tracks && item.tracks.length > 0) {
      setRestored({ url: item.url, title: item.title, tracks: item.tracks });
      setCleaned(true);
    }
    reconnectBundleFor(item.url);
  };

  const pickFolder = async () => {
    const w = window as DirectoryPickerWindow;
    if (w.showDirectoryPicker) {
      try {
        const handle = await w.showDirectoryPicker({ mode: "read" });
        const collected = await collectFromDirectory(handle);
        collected.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        setFiles(collected);
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // fall through to input fallback
      }
    }
    folderInputRef.current?.click();
  };

  // Save nice titles to Recent once the scan reports them.
  const scanTitle = scan?.info?.title;
  useEffect(() => {
    if (scanTitle && mode === "url" && url) addRecent(url, scanTitle);
  }, [scanTitle, mode, url]);

  // Once a scan ends, save its tracklist so Recent can restore it later.
  // File/folder scans get a `file:` pseudo-key — they can't be re-scanned from
  // Recent (the file lives on the user's disk) but their result can be reopened.
  // Saved once per job: the deps below change again after completion (DJ Pool
  // probe, merge rounds, …) and re-saving would resurrect an item the user
  // just removed with Clear.
  const savedRecentJobId = useRef<string | null>(null);
  useEffect(() => {
    if (!done || !job || !scan || sourceTracks.length === 0) return;
    if (savedRecentJobId.current === job.id) return;
    savedRecentJobId.current = job.id;
    if (scan.mode === "url") {
      if (url) addRecent(url, scan.info?.title, sourceTracks);
    } else {
      const first = files[0]?.name;
      if (!first) return;
      const name = files.length > 1 ? `${first} +${files.length - 1} more` : first;
      addRecent(`file:${name}`, name, sourceTracks, scan.mode);
    }
  }, [done, job, scan, url, files, sourceTracks]);

  /** Scan settings with the chosen preset applied on top of Settings values. */
  const effectiveScanSettings = (): ScanSettings => {
    if (preset === "fast") return { ...settings.scan, smartScan: true, scanInterval: 30 };
    if (preset === "thorough") return { ...settings.scan, smartScan: false, scanInterval: 20 };
    return settings.scan;
  };

  const startScanJob = (scanMode: ScanMode) => {
    void start(() => {
      const form = new FormData();
      form.set("mode", scanMode);
      form.set("settings", JSON.stringify(effectiveScanSettings()));
      if (scanMode === "url") {
        form.set("url", url);
      } else {
        for (const file of files) form.append("files", file, file.name);
      }
      return fetch("/api/jobs/scan", { method: "POST", body: form });
    });
  };

  const pendingScanSource =
    mode === "url"
      ? url.trim()
      : files[0]
        ? `file:${files.length > 1 ? `${files[0].name} +${files.length - 1} more` : files[0].name}`
        : "";
  const sameAsRunningBundle = Boolean(
    (djRunning || djPaused) && djState && sameSource(djState.sourceUrl, pendingScanSource),
  );

  const beginScan = () => {
    // Same mix already downloading — go back to that list instead of
    // starting a second scan on top of Download All.
    if (sameAsRunningBundle) {
      returnToBundle();
      return;
    }
    // A different source: don't scan and download at the same time.
    if (djRunning) void djJob.pause();
    clearResults();
    if (mode === "url") addRecent(url.trim());
    startScanJob(mode);
  };

  // Mode of the currently displayed result (live job or restored Recent item).
  const resultMode: ScanMode | null = scan
    ? scan.mode
    : restored
      ? restored.url.startsWith("file:")
        ? "file"
        : "url"
      : null;
  // Rescan needs the original source to still be around (URL text / picked files).
  const canRescan =
    resultMode === "url"
      ? url.trim().length > 0
      : resultMode === "file" || resultMode === "folder"
        ? files.length > 0
        : false;

  /** Scan the same source again and merge new detections into the current list. */
  const rescanMerge = () => {
    if (!resultMode || !canRescan) return;
    setBaseTracks(sourceTracks);
    setMergeRounds((n) => n + 1);
    setRestored(null);
    if (!djRunning && !djPaused) {
      djJob.reset();
      djJobTrackIds.current = [];
      setResumeFromJobId(null);
    }
    startScanJob(resultMode);
  };

  const canStart = mode === "url" ? url.trim().length > 0 : files.length > 0;

  // Local audio preview for single-file scans.
  const fileUrl = useMemo(() => (files[0] ? URL.createObjectURL(files[0]) : null), [files]);
  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  const embedUrl = job && scan?.mode === "url" ? youtubeEmbed(url) : null;

  return (
    <div className={`space-y-8 ${nowPlaying ? "pb-24" : ""}`}>
      {/* ---------- Scan section ---------- */}
      <section className="mx-auto max-w-3xl rounded-2xl border border-border bg-surface/50 p-5 lg:p-7">
        {!job ? (
          <div className="space-y-6">
            <div>
              {/* <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted">
                What do you want to scan?
              </label> */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {SOURCES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setMode(s.id);
                      setFiles([]);
                    }}
                    className={`rounded-xl border p-5 text-left transition-colors ${
                      mode === s.id
                        ? "border-accent bg-accent-soft/60"
                        : "border-border bg-surface hover:border-border-strong"
                    }`}
                  >
                    <div className={mode === s.id ? "text-accent" : "text-muted"}>{s.icon}</div>
                    <div className="mt-2.5 text-sm font-semibold">{s.name}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-muted">{s.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* URL form */}
            {mode === "url" && (
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted">
                  URL
                </label>
                <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-1 focus-within:border-accent">
                  <Link2 size={16} className="shrink-0 text-muted" />
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && canStart && beginScan()}
                    placeholder="Paste YouTube URL"
                    className="w-full bg-transparent py-2.5 text-sm text-text outline-none placeholder:text-muted/60"
                  />
                </div>
              </div>
            )}

            {/* File form */}
            {mode === "file" && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []).filter((f) => isAudioFile(f.name)).slice(0, 1))}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-6 text-sm text-muted transition-colors hover:border-accent hover:text-text"
                >
                  <FileAudio size={16} />
                  {files.length > 0 ? "Choose a different file" : "Choose Audio File"}
                </button>
                {files[0] && (
                  <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="truncate font-medium">{files[0].name}</span>
                      <span className="ml-3 shrink-0 font-mono text-xs text-muted">
                        {(files[0].size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    </div>
                    {fileUrl && <audio controls src={fileUrl} className="h-9 w-full" preload="metadata" />}
                  </div>
                )}
              </div>
            )}

            {/* Folder form */}
            {mode === "folder" && (
              <div>
                <input
                  ref={folderInputRef}
                  type="file"
                  accept={ACCEPT}
                  multiple
                  // @ts-expect-error non-standard attribute for directory selection fallback
                  webkitdirectory=""
                  className="hidden"
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []).filter((f) => isAudioFile(f.name));
                    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                    setFiles(list);
                  }}
                />
                <button
                  type="button"
                  onClick={pickFolder}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-6 text-sm text-muted transition-colors hover:border-accent hover:text-text"
                >
                  <FolderOpen size={16} />
                  {files.length > 0 ? "Choose a different folder" : "Choose Folder"}
                </button>
                {files.length > 0 && (
                  <div className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                    <span className="font-medium">{files.length} audio files selected</span>
                    <div className="mt-1 truncate text-xs text-muted">
                      {files.slice(0, 4).map((f) => f.name).join(", ")}
                      {files.length > 4 && ` +${files.length - 4} more`}
                    </div>
                  </div>
                )}
              </div>
            )}
<hr className="h-px border-0 bg-white/20" />
            {/* Scan preset — collapsed by default; people rarely change it. */}
            <div>
              <button
                type="button"
                onClick={() => setModeOpen((o) => !o)}
                className="flex w-full items-center gap-2 text-left"
                aria-expanded={modeOpen}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">MODE</span>
                <span className="text-xs font-medium text-accent">
                  {PRESETS.find((p) => p.id === preset)?.name}
                </span>
                <ChevronDown
                  size={14}
                  className={`ml-auto text-muted transition-transform ${modeOpen ? "rotate-180" : ""}`}
                />
              </button>
              {modeOpen && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPreset(p.id)}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                        preset === p.id
                          ? "border-accent bg-accent-soft/60"
                          : "border-border bg-surface hover:border-border-strong"
                      }`}
                    >
                      <div className={`text-sm font-semibold ${preset === p.id ? "text-accent" : ""}`}>
                        {p.name}
                      </div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-muted">{p.description}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={beginScan}
                disabled={!canStart || starting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-gradient px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sameAsRunningBundle ? <DownloadCloud size={16} /> : <ScanLine size={16} />}
                {starting ? "Starting…" : sameAsRunningBundle ? "Back to download" : "Start Scan"}
              </button>
              {sameAsRunningBundle && (
                <p className="text-center text-xs text-muted">
                  This mix is already downloading. Open it instead of scanning again.
                  {djPaused ? " Download All is paused — you can continue from there." : ""}
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                {error}
              </div>
            )}
          </div>
        ) : (
          scan && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusBadge status={job.status} />
                  {scan.info?.title && (
                    <span className="max-w-md truncate text-sm text-muted">{scan.info.title}</span>
                  )}
                </div>
                {running ? (
                  <button
                    type="button"
                    onClick={cancel}
                    title="Stop scanning — songs found so far are kept"
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  >
                    <Square size={12} /> Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={resetAll}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted hover:text-text"
                  >
                    <RotateCcw size={13} /> New Scan
                  </button>
                )}
              </div>

              {/* Source preview: YouTube embed for URL scans */}
              {embedUrl && (
                <div className="overflow-hidden rounded-xl border border-border bg-black sm:max-w-sm">
                  <iframe
                    src={embedUrl}
                    title="Source preview"
                    className="aspect-video w-full"
                    allow="accelerometer; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}
              {/* Local audio preview for file scans */}
              {!embedUrl && scan.mode === "file" && fileUrl && (
                <audio controls src={fileUrl} className="h-9 w-full sm:max-w-sm" preload="metadata" />
              )}

              {job.error && (
                <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                  {job.error}
                </div>
              )}

              {(scan.samplesFailed ?? 0) > 0 && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                  <div className="space-y-1.5">
                    <p className="font-medium">
                      Shazam temporarily blocked {scan.samplesFailed} check
                      {scan.samplesFailed === 1 ? "" : "s"} (rate limit)
                    </p>
                    <ul className="list-disc space-y-1 pl-4 text-[13px] text-amber-300/80">
                      <li>
                        Only {scan.samplesFailed === 1 ? "one sample point was" : "a few sample points were"} skipped
                        — usually not a whole song, since each song is checked at several points.
                      </li>
                      <li>
                        The scanner handles this itself: it slows down and re-checks any large
                        uncovered stretch at the end of the scan.
                      </li>
                      <li>
                        Act only if a song looks missing (a big jump between timestamps): wait a
                        few minutes, then press <span className="font-medium">Rescan &amp; Merge</span> —
                        found songs are kept.
                      </li>
                      {acrConfigured === false && (
                        <li>
                          Tip: adding ACRCloud keys in Settings gives the scanner a second
                          recognition service to fall back on.
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              )}

              <div>
                <ProgressBar value={scan.overallProgress} active={running} />
                <div className="mt-1.5 flex justify-between text-xs text-muted">
                  <span>Overall Progress</span>
                  <span className="font-mono">{scan.overallProgress.toFixed(0)}%</span>
                </div>
              </div>

              {/* Stats */}
              <div className={`grid grid-cols-2 gap-3 ${scan.totalFiles > 1 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
                {scan.totalFiles > 1 && (
                  <Stat label="Files" value={`${Math.min(scan.fileIndex + 1, scan.totalFiles)} / ${scan.totalFiles}`} />
                )}
                <Stat
                  label="Current Position"
                  value={
                    scan.totalDuration > 0
                      ? `${formatTimestamp(scan.currentTimestamp)} / ${formatTimestamp(scan.totalDuration)}`
                      : "—"
                  }
                />
                <Stat
                  label="Samples Scanned"
                  value={scan.totalSamples > 0 ? `${scan.samplesScanned} / ~${scan.totalSamples}` : "—"}
                />
                <Stat label="File Progress" value={`${scan.fileProgress.toFixed(0)}%`} />
                <Stat label="Songs Found" value={String(scan.songsFound)} />
              </div>

              {scan.totalFiles > 1 && scan.currentFile && (
                <div className="truncate rounded-xl border border-border bg-surface px-4 py-2.5 text-xs text-muted">
                  Current file: <span className="font-medium text-text">{scan.currentFile}</span>
                </div>
              )}
            </div>
          )
        )}
      </section>

      {/* ---------- Recent ---------- */}
      <RecentRow onSelect={onSelectRecent} disabled={running || starting} />

      {/* ---------- Tracklist ---------- */}
      {((job && scan) || restored) && (
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <h2 className="flex shrink-0 items-center gap-2 border-b-2 border-accent pb-1 text-sm font-semibold text-accent">
                <ListMusic size={14} className={running ? "animate-pulse-soft" : ""} />
                {running ? "Live Tracklist" : "Tracklist"}
                {cleaned && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium normal-case">
                    cleaned
                  </span>
                )}
                {mergeRounds > 0 && (
                  <span
                    className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium normal-case"
                    title={`Merged results from ${mergeRounds + 1} scan rounds`}
                  >
                    merged ×{mergeRounds + 1}
                  </span>
                )}
              </h2>
              {!job && restored && (
                <span className="truncate text-xs text-muted" title={restored.title ?? restored.url}>
                  from Recent · {restored.title ?? restored.url}
                </span>
              )}
            </div>
            {resultsReady && hasTracks && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Source selection chip */}
                <button
                  type="button"
                  onClick={() => setSourceDialogOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-text"
                  title="Change where tracks are searched and downloaded from"
                >
                  <Settings2 size={13} /> {sourcesLabel}
                </button>

                {/* Bundle controls */}
                {!djOnThisList && !djRunning && (
                  <button
                    type="button"
                    onClick={downloadAll}
                    disabled={!anySourceUsable || downloadableTracks.length === 0}
                    title={
                      !anySourceUsable
                        ? "No usable download source — check Sources"
                        : downloadableTracks.length === 0
                          ? "No tracks available on the selected sources"
                        : canContinue
                          ? `Resume after Stop — skip ${downloadableTracks.length - remainingTracks.length} already saved, fetch the rest`
                        : downloadableTracks.length < displayTracks.length
                          ? `${displayTracks.length - downloadableTracks.length} excluded (unchecked, or not available on the selected sources)`
                          : undefined
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-accent-gradient px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <DownloadCloud size={13} />{" "}
                    {canContinue
                      ? `Continue (${continueCount})`
                      : `Download All (${downloadableTracks.length})`}
                  </button>
                )}
                {(djRunning || djPaused) && !bundleBelongsHere && (
                  <button
                    type="button"
                    onClick={returnToBundle}
                    className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/50 px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-accent"
                    title="Download All is still running on another tracklist"
                  >
                    <Loader2 size={13} className="animate-spin text-accent" /> View download
                  </button>
                )}
                {djOnThisList && (
                  <button
                    type="button"
                    onClick={() => void stopBundle()}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  >
                    <Square size={12} /> Stop
                  </button>
                )}
                {djCompleted && djState?.bundleName && djState.downloaded > 0 && (
                  <a
                    href={`/api/jobs/${djJob.job!.id}/file`}
                    className="flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    <FileArchive size={13} /> Download ZIP
                    {djState.bundleSize ? ` (${formatBytes(djState.bundleSize)})` : ""}
                  </a>
                )}

                <span className="mx-1 h-4 w-px bg-border" />

                {canRescan && (
                  <button
                    type="button"
                    onClick={rescanMerge}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
                    title="Scan the same source again and merge newly found songs into this list"
                  >
                    <ScanLine size={13} /> Rescan &amp; Merge
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCleaned((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    cleaned
                      ? "border-accent bg-accent-soft/60 text-text"
                      : "border-border bg-surface-2 text-muted hover:text-text"
                  }`}
                >
                  <Sparkles size={13} /> Clean Tracklist
                </button>
                {/* <button
                  type="button"
                  onClick={() => setShowExport(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted hover:text-text"
                >
                  <Share size={13} /> Export
                </button> */}
              </div>
            )}
          </div>

          {djJob.error && (
            <div className="mb-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {djJob.error}
            </div>
          )}
          {djPoolConfigured === false && sourcePrefs.djpool && resultsReady && hasTracks && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <span>
                DJ Pool downloads are disabled — add DJPOOL_EMAIL and DJPOOL_PASSWORD to .env.local and restart.
              </span>
            </div>
          )}

          {djOnThisList && djState && (
            <div className="mb-4">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-muted">
                  <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
                  <span className="truncate">
                    {djBundling
                      ? "Creating ZIP…"
                      : djCurrent
                        ? `${djCurrent.artist ? `${djCurrent.artist} — ` : ""}${djCurrent.title}`
                        : "Starting…"}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-muted">
                  {djState.processed}/{djState.total}
                  {djState.total > 0
                    ? ` · ${Math.round((djState.processed / djState.total) * 100)}%`
                    : ""}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent-gradient transition-[width] duration-300"
                  style={{
                    width: `${djState.total > 0 ? Math.min(100, (djState.processed / djState.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="relative">
            <TracklistGrid
              tracks={displayTracks}
              djPool={resultsReady && !djOnThisList ? djColumn : undefined}
              playingId={nowPlaying?.trackId}
            />
            {djOnThisList && (
              <div className="absolute inset-0 z-10 rounded-xl bg-black/55 backdrop-blur-[2px]">
                <div className="sticky top-28 flex justify-center px-4 pt-10">
                  <div className="text-center">
                    <p className="text-sm font-semibold tracking-wide text-white">Downloading All</p>
                    <p className="mt-1 text-xs text-white/70">
                      {djBundling ? "Packing the ZIP…" : "Please wait — tracks are being saved in order"}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          {done && !hasTracks && (
            <p className="mt-3 text-center text-sm text-muted">
              No songs were detected in this audio.
            </p>
          )}
        </section>
      )}

      {(djRunning || djPaused) && djState && !djOnThisList && (
        <div
          className={`fixed right-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-accent/30 bg-surface/95 p-3 shadow-2xl shadow-black/40 backdrop-blur-md ${
            nowPlaying ? "bottom-24" : "bottom-4"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <Loader2
              size={16}
              className={`mt-0.5 shrink-0 text-accent ${djRunning ? "animate-spin" : ""}`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text">
                {djPaused ? "Download All paused" : "Download All is still running"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {djState.sourceTitle || djState.sourceUrl || "Tracklist"}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted">
                {djState.processed}/{djState.total}
                {djState.total > 0
                  ? ` · ${Math.round((djState.processed / djState.total) * 100)}%`
                  : ""}
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent-gradient transition-[width] duration-300"
                  style={{
                    width: `${djState.total > 0 ? Math.min(100, (djState.processed / djState.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={returnToBundle}
                  className="rounded-lg bg-accent-gradient px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  View
                </button>
                {djRunning && (
                  <button
                    type="button"
                    onClick={() => void stopBundle()}
                    className="rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger"
                  >
                    Stop
                  </button>
                )}
                {djPaused && (
                  <button
                    type="button"
                    onClick={downloadAll}
                    className="rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text transition-colors hover:border-accent"
                  >
                    Continue
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {nowPlaying && (
        <PlayerBar key={nowPlaying.src} track={nowPlaying} onClose={() => setNowPlaying(null)} />
      )}
      {showExport && <ExportDialog tracks={displayTracks} onClose={() => setShowExport(false)} />}

      {/* Source chooser: opens automatically the first time results appear,
          afterwards via the Sources chip. */}
      {resultsReady && hasTracks && (sourceDialogOpen || !sourcesChosen) && (
        <SourceDialog
          initial={sourcePrefs}
          djPoolConfigured={djPoolConfigured}
          onConfirm={onSourcesConfirm}
        />
      )}
    </div>
  );
}
