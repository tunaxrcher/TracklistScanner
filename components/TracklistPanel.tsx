"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DownloadCloud,
  FileArchive,
  FileAudio,
  FolderOpen,
  Globe,
  Link2,
  ListMusic,
  RotateCcw,
  ScanLine,
  Share,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useJob } from "@/lib/client/useJob";
import type { AppSettings } from "@/lib/client/settings";
import type { DjPoolCandidate, ScanMode, TrackEntry } from "@/lib/types";
import { cleanTracklist, formatTimestamp } from "@/lib/tracklist";
import {
  filenameFromResponse,
  rowStatusFromJob,
  saveBlob,
  type DjRowState,
} from "@/lib/client/djpool";
import { addRecent } from "@/lib/client/recent";
import { EXAMPLE_URLS } from "@/lib/client/examples";
import { ProgressBar, Stat, StatusBadge, formatBytes } from "@/components/ui";
import { TracklistTable, type DjPoolColumn } from "@/components/TracklistTable";
import { ExportDialog } from "@/components/ExportDialog";

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
  prefillUrl,
  prefillKey,
}: {
  settings: AppSettings;
  djPoolConfigured: boolean | null;
  prefillUrl?: string;
  prefillKey?: number;
}) {
  const [mode, setMode] = useState<ScanMode | null>(null);
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
    error?: string;
  }>({ trackId: null, loading: false, candidates: [] });
  // Ordered track ids sent to the current bundle job, for index → id mapping.
  const djJobTrackIds = useRef<string[]>([]);

  const scan = job?.scan;
  const running = job != null && !["completed", "failed", "cancelled"].includes(job.status);
  const finished = job?.status === "completed";

  const displayTracks: TrackEntry[] = useMemo(() => {
    const tracks = scan?.tracks ?? [];
    return cleaned ? cleanTracklist(tracks) : tracks;
  }, [scan?.tracks, cleaned]);

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
        next[id] = { status: rowStatusFromJob(jt.status), fileName: jt.fileName, error: jt.error };
      });
      return next;
    });
  }, [djState]);

  const downloadBest = useCallback(
    async (track: TrackEntry) => {
      setDjRows((r) => ({ ...r, [track.id]: { status: "searching" } }));
      try {
        const res = await fetch("/api/djpool/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: track.title, artist: track.artist, preferences: settings.djpool }),
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
        const blob = await res.blob();
        const name = filenameFromResponse(res, `${track.artist} - ${track.title}.mp3`);
        saveBlob(blob, name);
        setDjRows((r) => ({ ...r, [track.id]: { status: "done", fileName: name } }));
      } catch (err) {
        setDjRows((r) => ({ ...r, [track.id]: { status: "failed", error: (err as Error).message } }));
      }
    },
    [settings.djpool],
  );

  const openPicker = useCallback(
    async (track: TrackEntry) => {
      setPicker({ trackId: track.id, loading: true, candidates: [] });
      try {
        const res = await fetch("/api/djpool/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: track.title, artist: track.artist, preferences: settings.djpool }),
        });
        const data = (await res.json()) as { candidates?: DjPoolCandidate[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Search failed.");
        setPicker({ trackId: track.id, loading: false, candidates: data.candidates ?? [] });
      } catch (err) {
        setPicker({ trackId: track.id, loading: false, candidates: [], error: (err as Error).message });
      }
    },
    [settings.djpool],
  );

  const closePicker = useCallback(() => setPicker({ trackId: null, loading: false, candidates: [] }), []);

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
        const blob = await res.blob();
        const name = filenameFromResponse(res, fallback);
        saveBlob(blob, name);
        setDjRows((r) => ({ ...r, [track.id]: { status: "done", fileName: name } }));
      } catch (err) {
        setDjRows((r) => ({ ...r, [track.id]: { status: "failed", error: (err as Error).message } }));
      }
    },
    [closePicker],
  );

  const downloadAll = useCallback(() => {
    const list = displayTracks;
    djJobTrackIds.current = list.map((t) => t.id);
    setDjRows((prev) => {
      const next = { ...prev };
      for (const t of list) next[t.id] = { status: "searching" };
      return next;
    });
    void djJob.start(() =>
      fetch("/api/jobs/djpool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: list.map((t) => ({ title: t.title, artist: t.artist })),
          preferences: settings.djpool,
        }),
      }),
    );
  }, [displayTracks, djJob, settings.djpool]);

  const djColumn: DjPoolColumn = {
    configured: djPoolConfigured,
    rows: djRows,
    picker,
    onDownload: downloadBest,
    onOpenPicker: openPicker,
    onClosePicker: closePicker,
    onPick: pickVersion,
  };

  const resetAll = () => {
    reset();
    djJob.reset();
    setDjRows({});
    closePicker();
    djJobTrackIds.current = [];
    setCleaned(false);
    setFiles([]);
    setUrl("");
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

  // Fill the URL input when a Recent item is clicked (adjust state on prop change).
  const [seenPrefill, setSeenPrefill] = useState(prefillKey);
  if (prefillKey !== seenPrefill) {
    setSeenPrefill(prefillKey);
    if (prefillUrl) {
      setMode("url");
      setUrl(prefillUrl);
    }
  }

  // Save nice titles to Recent once the scan reports them.
  const scanTitle = scan?.info?.title;
  useEffect(() => {
    if (scanTitle && mode === "url" && url) addRecent("tracklist", url, scanTitle);
  }, [scanTitle, mode, url]);

  const beginScan = () => {
    if (mode === "url") addRecent("tracklist", url.trim());
    void start(() => {
      const form = new FormData();
      form.set("mode", mode!);
      form.set("settings", JSON.stringify(settings.scan));
      if (mode === "url") {
        form.set("url", url);
      } else {
        for (const file of files) form.append("files", file, file.name);
      }
      return fetch("/api/jobs/scan", { method: "POST", body: form });
    });
  };

  const canStart =
    mode === "url" ? url.trim().length > 0 : files.length > 0;

  return (
    <div className="space-y-6">
      {/* Source selector */}
      {!job && (
        <>
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted">
              What do you want to scan?
            </label>
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
              <p className="mt-2 text-xs text-muted">
                Audio is analyzed directly — no MP3 download required.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Try:</span>
                {EXAMPLE_URLS.tracklist.map((ex) => (
                  <button
                    key={ex.url}
                    type="button"
                    onClick={() => setUrl(ex.url)}
                    className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
                  >
                    {ex.label}
                  </button>
                ))}
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
                <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                  <span className="truncate font-medium">{files[0].name}</span>
                  <span className="ml-3 shrink-0 font-mono text-xs text-muted">
                    {(files[0].size / (1024 * 1024)).toFixed(1)} MB
                  </span>
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

          {mode && (
            <button
              type="button"
              onClick={beginScan}
              disabled={!canStart || starting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ScanLine size={16} />
              {starting ? "Starting…" : "Start Scan"}
            </button>
          )}

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}
        </>
      )}

      {/* Scan progress */}
      {job && scan && (
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
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger"
              >
                <X size={13} /> Cancel
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

          {job.error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {job.error}
            </div>
          )}

          {(scan.samplesFailed ?? 0) > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <span>
                {scan.samplesFailed} sample{scan.samplesFailed === 1 ? "" : "s"} could not be
                checked (Shazam rate limit). Results may be incomplete — the scanner slows down
                automatically, but for full coverage wait a few minutes and rescan, or add
                ACRCloud keys as a fallback.
              </span>
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

          {/* Live / final tracklist */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <ListMusic size={13} className={running ? "animate-pulse-soft text-accent" : ""} />
                {running ? "Live Tracklist" : "Tracklist"}
                {cleaned && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium normal-case text-accent">
                    cleaned
                  </span>
                )}
              </h3>
              {finished && scan.tracks.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {/* DJ Pool bundle controls */}
                  {!djJob.job && (
                    <button
                      type="button"
                      onClick={downloadAll}
                      disabled={djPoolConfigured === false}
                      title={djPoolConfigured === false ? "DJ Pool account not configured" : undefined}
                      className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <DownloadCloud size={13} /> Download All ({displayTracks.length})
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
                        <X size={13} /> Cancel
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
                  <button
                    type="button"
                    onClick={() => setShowExport(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted hover:text-text"
                  >
                    <Share size={13} /> Export
                  </button>
                </div>
              )}
            </div>

            {djJob.error && (
              <div className="mb-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                {djJob.error}
              </div>
            )}
            {djPoolConfigured === false && finished && scan.tracks.length > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                <span>
                  DJ Pool downloads are disabled — add DJPOOL_EMAIL and DJPOOL_PASSWORD to .env.local and restart.
                </span>
              </div>
            )}

            <TracklistTable
              tracks={displayTracks}
              showFile
              djPool={finished ? djColumn : undefined}
            />
            {finished && scan.tracks.length === 0 && (
              <p className="mt-3 text-center text-sm text-muted">
                No songs were detected in this audio.
              </p>
            )}
          </div>
        </div>
      )}

      {showExport && <ExportDialog tracks={displayTracks} onClose={() => setShowExport(false)} />}
    </div>
  );
}
