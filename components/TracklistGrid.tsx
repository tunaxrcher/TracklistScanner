"use client";

import Image from "next/image";
import {
  Check,
  ChevronDown,
  CircleSlash,
  Download,
  Loader2,
  Music2,
  Play,
  RotateCcw,
  Volume2,
} from "lucide-react";
import type { DjPoolCandidate, TrackEntry } from "@/lib/types";
import { formatTimestamp } from "@/lib/tracklist";
import type { DjRowState } from "@/lib/client/djpool";

export interface DjPoolColumn {
  configured: boolean | null;
  /** Per-track state keyed by TrackEntry.id */
  rows: Record<string, DjRowState>;
  picker: {
    trackId: string | null;
    loading: boolean;
    candidates: DjPoolCandidate[];
    error?: string;
  };
  onDownload: (track: TrackEntry) => void;
  onOpenPicker: (track: TrackEntry) => void;
  onClosePicker: () => void;
  onPick: (track: TrackEntry, candidate: DjPoolCandidate) => void;
  /** Whether a probe-matched candidate exists that can be previewed. */
  canPlay: (track: TrackEntry) => boolean;
  onPlay: (track: TrackEntry) => void;
  onPlayCandidate: (track: TrackEntry, candidate: DjPoolCandidate) => void;
}

function DjPoolActions({ track, dj }: { track: TrackEntry; dj: DjPoolColumn }) {
  const row = dj.rows[track.id];
  const state = row?.status ?? "idle";
  const fileName = row?.fileName;
  const progress = row?.progress;
  const pickerOpen = dj.picker.trackId === track.id;
  const disabled = dj.configured === false;

  return (
    <div className="relative flex items-center gap-1">
      {state === "checking" && (
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={13} className="animate-spin" /> Checking…
        </span>
      )}
      {state === "searching" && (
        <span className="flex items-center gap-1.5 text-xs text-sky-300">
          <Loader2 size={13} className="animate-spin" /> Finding…
        </span>
      )}
      {state === "downloading" && (
        <div className="flex w-28 items-center gap-2" title="Downloading from DJ Pool">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full bg-accent-gradient transition-[width] duration-200 ${
                progress == null ? "w-full animate-pulse-soft" : ""
              }`}
              style={progress != null ? { width: `${progress}%` } : undefined}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted">
            {progress != null ? `${progress}%` : "…"}
          </span>
        </div>
      )}
      {state === "notfound" && (
        <span className="flex items-center gap-1.5 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
          <CircleSlash size={13} /> Not found
        </span>
      )}
      {state === "done" && (
        <span className="flex max-w-32 items-center gap-1.5 text-xs text-success" title={fileName}>
          <Check size={13} className="shrink-0" /> <span className="truncate">Saved</span>
        </span>
      )}
      {state === "failed" && (
        <button
          type="button"
          onClick={() => dj.onDownload(track)}
          className="flex items-center gap-1.5 text-xs text-danger hover:underline"
          title={dj.rows[track.id]?.error}
        >
          <RotateCcw size={13} /> Retry
        </button>
      )}

      {(state === "idle" || state === "available" || state === "done" || state === "notfound" || state === "failed") && (
        <div className="flex items-center">
          {(state === "idle" || state === "available") && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => dj.onDownload(track)}
              className="flex items-center gap-1.5 rounded-l-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              title={disabled ? "DJ Pool account not configured" : "Download best match"}
            >
              <Download size={13} /> Get
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => (pickerOpen ? dj.onClosePicker() : dj.onOpenPicker(track))}
            className={`flex items-center rounded-lg border border-border bg-surface-2 px-1.5 py-1.5 text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 ${
              state === "idle" || state === "available" ? "rounded-l-none border-l-0" : ""
            } ${pickerOpen ? "border-accent text-accent" : ""}`}
            title="Choose a version"
          >
            <ChevronDown size={13} className={pickerOpen ? "rotate-180 transition-transform" : "transition-transform"} />
          </button>
        </div>
      )}

      {pickerOpen && <div className="fixed inset-0 z-10" onClick={dj.onClosePicker} />}

      {pickerOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Choose a version
            <button type="button" onClick={dj.onClosePicker} className="text-muted hover:text-text">
              ✕
            </button>
          </div>
          {dj.picker.loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted">
              <Loader2 size={15} className="animate-spin" /> Searching DJ Pool…
            </div>
          ) : dj.picker.error ? (
            <div className="px-3 py-4 text-sm text-danger">{dj.picker.error}</div>
          ) : dj.picker.candidates.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted">No versions found.</div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {dj.picker.candidates.map((c, i) => (
                <div
                  key={`${c.download}-${i}`}
                  className="flex items-center gap-1 border-b border-border/50 last:border-0 hover:bg-surface-2"
                >
                  <button
                    type="button"
                    onClick={() => dj.onPlayCandidate(track, c)}
                    className="shrink-0 rounded-full p-2 text-muted transition-colors hover:text-accent"
                    title="Preview"
                  >
                    <Play size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => dj.onPick(track, c)}
                    className="flex min-w-0 flex-1 items-start gap-2 py-2 pr-3 text-left"
                    title="Download this version"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{c.name}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {c.size}
                        {c.reasons.length > 0 && ` · ${c.reasons.join(", ")}`}
                      </span>
                    </span>
                    {i === 0 && (
                      <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        best
                      </span>
                    )}
                    <Download size={13} className="mt-0.5 shrink-0 text-muted" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Numbered multi-column tracklist ("Weekly Top 15" style).
 * Items flow top-to-bottom per column via CSS multi-columns.
 */
export function TracklistGrid({
  tracks,
  djPool,
  playingId,
}: {
  tracks: TrackEntry[];
  djPool?: DjPoolColumn;
  playingId?: string;
}) {
  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-muted">
        <Music2 size={22} />
        <span className="text-sm">No songs detected yet</span>
      </div>
    );
  }

  return (
    <div className="columns-1 gap-10 md:columns-2 xl:columns-3">
      {tracks.map((track, i) => {
        const isPlaying = playingId === track.id;
        const playable = djPool?.canPlay(track) ?? false;
        return (
          <div
            key={track.id}
            className="animate-track-in flex break-inside-avoid items-center gap-3 border-b border-border/60 py-3"
          >
            <span
              className={`w-9 shrink-0 text-2xl font-bold tabular-nums ${
                isPlaying ? "text-accent-gradient" : "text-text/70"
              }`}
            >
              {String(i + 1).padStart(2, "0")}
            </span>

            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2">
              {track.coverUrl ? (
                <Image src={track.coverUrl} alt="" fill unoptimized sizes="40px" className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted">
                  <Music2 size={14} />
                </div>
              )}
              {playable && (
                <button
                  type="button"
                  onClick={() => djPool!.onPlay(track)}
                  className={`absolute inset-0 flex items-center justify-center bg-black/55 text-white transition-opacity ${
                    isPlaying ? "opacity-100" : "opacity-0 hover:opacity-100"
                  }`}
                  title="Preview from DJ Pool"
                >
                  {isPlaying ? <Volume2 size={15} className="animate-pulse-soft" /> : <Play size={15} />}
                </button>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div
                className={`truncate text-sm font-medium ${isPlaying ? "text-accent" : ""}`}
                title={track.title}
              >
                {track.title}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted" title={track.file}>
                {track.artist}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted/80">
                <span className="font-mono">{formatTimestamp(track.timestamp)}</span>
                <span
                  className={`rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${
                    track.provider === "shazam"
                      ? "bg-sky-400/10 text-sky-300"
                      : "bg-amber-400/10 text-amber-300"
                  }`}
                  title={`Recognized by ${track.provider === "shazam" ? "Shazam" : "ACRCloud"}`}
                >
                  {track.provider === "shazam" ? "Shazam" : "ACR"}
                </span>
              </div>
            </div>

            {djPool && (
              <div className="shrink-0">
                <DjPoolActions track={track} dj={djPool} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
