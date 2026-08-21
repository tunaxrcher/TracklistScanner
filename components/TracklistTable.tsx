"use client";

import Image from "next/image";
import { Check, ChevronDown, CircleSlash, Download, Loader2, Music2, RotateCcw } from "lucide-react";
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
}

function DjPoolCell({ track, dj }: { track: TrackEntry; dj: DjPoolColumn }) {
  const state = dj.rows[track.id]?.status ?? "idle";
  const fileName = dj.rows[track.id]?.fileName;
  const pickerOpen = dj.picker.trackId === track.id;
  const disabled = dj.configured === false;

  return (
    <div className="relative flex items-center gap-1">
      {state === "searching" && (
        <span className="flex items-center gap-1.5 text-xs text-sky-300">
          <Loader2 size={13} className="animate-spin" /> Finding…
        </span>
      )}
      {state === "downloading" && (
        <span className="flex items-center gap-1.5 text-xs text-accent">
          <Loader2 size={13} className="animate-spin" /> Downloading…
        </span>
      )}
      {state === "notfound" && (
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <CircleSlash size={13} /> Not found
        </span>
      )}
      {state === "done" && (
        <span className="flex max-w-40 items-center gap-1.5 text-xs text-success" title={fileName}>
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

      {(state === "idle" || state === "done" || state === "notfound" || state === "failed") && (
        <div className="flex items-center">
          {state === "idle" && (
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
              state === "idle" ? "rounded-l-none border-l-0" : ""
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
                <button
                  key={`${c.download}-${i}`}
                  type="button"
                  onClick={() => dj.onPick(track, c)}
                  className="flex w-full items-start gap-2 border-b border-border/50 px-3 py-2 text-left last:border-0 hover:bg-surface-2"
                >
                  <Download size={13} className="mt-0.5 shrink-0 text-muted" />
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
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TracklistTable({
  tracks,
  showFile,
  djPool,
}: {
  tracks: TrackEntry[];
  showFile: boolean;
  djPool?: DjPoolColumn;
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
    <div className="overflow-x-auto overflow-y-visible rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
            <th className="px-3 py-2.5 font-medium">#</th>
            <th className="px-3 py-2.5 font-medium">Timestamp</th>
            <th className="px-3 py-2.5 font-medium">Cover</th>
            <th className="px-3 py-2.5 font-medium">Song</th>
            <th className="px-3 py-2.5 font-medium">Artist</th>
            <th className="px-3 py-2.5 font-medium">Recognition</th>
            {showFile && <th className="px-3 py-2.5 font-medium">File</th>}
            {djPool ? (
              <th className="px-3 py-2.5 font-medium">DJ Pool</th>
            ) : (
              <th className="px-3 py-2.5 font-medium">Status</th>
            )}
          </tr>
        </thead>
        <tbody>
          {tracks.map((track, i) => (
            <tr key={track.id} className="animate-track-in border-b border-border/50 bg-surface last:border-0">
              <td className="px-3 py-2.5 font-mono text-xs text-muted">{i + 1}</td>
              <td className="px-3 py-2.5 font-mono text-xs">{formatTimestamp(track.timestamp)}</td>
              <td className="px-3 py-2.5">
                {track.coverUrl ? (
                  <Image
                    src={track.coverUrl}
                    alt=""
                    width={36}
                    height={36}
                    unoptimized
                    className="h-9 w-9 rounded-md border border-border object-cover"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-2 text-muted">
                    <Music2 size={14} />
                  </div>
                )}
              </td>
              <td className="max-w-56 truncate px-3 py-2.5 font-medium">{track.title}</td>
              <td className="max-w-44 truncate px-3 py-2.5 text-muted">{track.artist}</td>
              <td className="px-3 py-2.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    track.provider === "shazam"
                      ? "bg-sky-400/10 text-sky-300"
                      : "bg-amber-400/10 text-amber-300"
                  }`}
                >
                  {track.provider === "shazam" ? "Shazam" : "ACRCloud"}
                </span>
              </td>
              {showFile && (
                <td className="max-w-40 truncate px-3 py-2.5 text-xs text-muted">{track.file}</td>
              )}
              <td className="px-3 py-2.5">
                {djPool ? (
                  <DjPoolCell track={track} dj={djPool} />
                ) : (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                    Found
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
