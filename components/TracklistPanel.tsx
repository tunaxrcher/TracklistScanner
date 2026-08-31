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
  const { job, starting, error, start, cancel, reset } = useJob();

  // Separate job stream for the "Download All" bundle.
  const djJob = useJob();
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
  // Ordered track ids sent to the current bundle job, for index → id mapping.
  const djJobTrackIds = useRef<string[]>([]);
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
  const djRunning = djJob.job != null && !["completed", "failed", "cancelled"].includes(djJob.job.status);
  const djCompleted = djJob.job?.status === "completed";

  // Merge live bundle-job state into per-row state (index-aligned).
  useEffect(() => {
    if (!djState) return;
    setDjRows((prev) => {
      const next = { ...prev };
      djState.tracks.forEach((jt, i) => {
        const id = djJobTrackIds.current[i];
        if (!id) return;
        const status = rowStatusFromJob(jt.status);
        const prevRow = next[id];
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
  }, [djState, pins]);

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

  const downloadAll = useCallback(() => {
    const list = downloadableTracks;
    djJobTrackIds.current = list.map(({ track }) => track.id);
    setDjRows((prev) => {
      const next = { ...prev };
      for (const { track } of list) next[track.id] = { status: "searching" };
      return next;
    });
    void djJob.start(() =>
      fetch("/api/jobs/djpool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: list.map(({ track, num }) => {
            const pin = pins[track.id];
            return {
              title: track.title,
              artist: track.artist,
              num,
              pin: pin ? { source: pin.source, url: pin.url, name: pin.name } : undefined,
            };
          }),
          preferences: settings.djpool,
          sources: sourcePrefs,
        }),
      }),
    );
  }, [downloadableTracks, djJob, settings.djpool, sourcePrefs, pins]);

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

  /** Clear every result-related state (DJ Pool rows, bundle job, player, …). */
  const clearResults = () => {
    djJob.reset();
    setDjRows({});
    setDjCandidates({});
    setSelected({});
    setPins({});
    closePicker();
    setNowPlaying(null);
    setRestored(null);
    setBaseTracks(null);
    setMergeRounds(0);
    djJobTrackIds.current = [];
    probedJobId.current = null;
    setCleaned(false);
  };

  const resetAll = () => {
    reset();
    clearResults();
    setFiles([]);
    setUrl("");
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
      return;
    }
    resetAll();
    setMode("url");
    setUrl(item.url);
    if (item.tracks && item.tracks.length > 0) {
      setRestored({ url: item.url, title: item.title, tracks: item.tracks });
      setCleaned(true);
    }
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
  useEffect(() => {
    if (!done || !scan || sourceTracks.length === 0) return;
    if (scan.mode === "url") {
      if (url) addRecent(url, scan.info?.title, sourceTracks);
    } else {
      const first = files[0]?.name;
      if (!first) return;
      const name = files.length > 1 ? `${first} +${files.length - 1} more` : first;
      addRecent(`file:${name}`, name, sourceTracks, scan.mode);
    }
  }, [done, scan, url, files, sourceTracks]);

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

  const beginScan = () => {
    // The form can be visible alongside a restored result — make sure no DJ
    // Pool state (old ZIP bundle, row statuses, probe cache) leaks into the
    // new scan.
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
    djJob.reset();
    djJobTrackIds.current = [];
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
      <section className="rounded-2xl border border-border bg-surface/50 p-5 lg:p-7">
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

            <button
              type="button"
              onClick={beginScan}
              disabled={!canStart || starting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-gradient px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ScanLine size={16} />
              {starting ? "Starting…" : "Start Scan"}
            </button>

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
                {!djJob.job && (
                  <button
                    type="button"
                    onClick={downloadAll}
                    disabled={!anySourceUsable || downloadableTracks.length === 0}
                    title={
                      !anySourceUsable
                        ? "No usable download source — check Sources"
                        : downloadableTracks.length === 0
                          ? "No tracks available on the selected sources"
                        : downloadableTracks.length < displayTracks.length
                          ? `${displayTracks.length - downloadableTracks.length} excluded (unchecked, or not available on the selected sources)`
                          : undefined
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-accent-gradient px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <DownloadCloud size={13} /> Download All ({downloadableTracks.length})
                  </button>
                )}
                {djRunning && djState && (
                  <>
                    <span className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted">
                      {djState.processed}/{djState.total} · {djState.downloaded} ready
                    </span>
                    <button
                      type="button"
                      onClick={djJob.cancel}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger"
                    >
                      <Square size={12} /> Stop
                    </button>
                  </>
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
                {djJob.job && !djRunning && (
                  <button
                    type="button"
                    onClick={() => {
                      djJob.reset();
                      djJobTrackIds.current = [];
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted hover:text-text"
                    title="Run bundle again"
                  >
                    <RotateCcw size={13} /> Redo
                  </button>
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

          <TracklistGrid
            tracks={displayTracks}
            djPool={resultsReady ? djColumn : undefined}
            playingId={nowPlaying?.trackId}
          />
          {done && !hasTracks && (
            <p className="mt-3 text-center text-sm text-muted">
              No songs were detected in this audio.
            </p>
          )}
        </section>
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
