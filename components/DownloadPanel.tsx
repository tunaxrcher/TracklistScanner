"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Download,
  FileAudio,
  Gauge,
  Gem,
  Link2,
  Music,
  RotateCcw,
  Waves,
  X,
} from "lucide-react";
import { useJob } from "@/lib/client/useJob";
import type { AppSettings } from "@/lib/client/settings";
import { addRecent } from "@/lib/client/recent";
import { EXAMPLE_URLS } from "@/lib/client/examples";
import type { DownloadFormat } from "@/lib/types";
import { formatTimestamp } from "@/lib/tracklist";
import { ProgressBar, StatusBadge, formatBytes } from "@/components/ui";

const FORMATS: {
  id: DownloadFormat;
  name: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "mp3",
    name: "MP3 HQ",
    description: "High quality + cover + metadata",
    icon: <Music size={18} />,
  },
  {
    id: "m4a",
    name: "M4A",
    description: "Compatible audio (iPhone, Apple Music)",
    icon: <FileAudio size={18} />,
  },
  {
    id: "original",
    name: "Original",
    description: "Best source audio, no conversion",
    icon: <Gem size={18} />,
  },
  {
    id: "wav",
    name: "WAV",
    description: "For audio / video editing",
    icon: <Waves size={18} />,
  },
];

export function DownloadPanel({
  settings,
  prefillUrl,
  prefillKey,
}: {
  settings: AppSettings;
  prefillUrl?: string;
  prefillKey?: number;
}) {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<DownloadFormat>("mp3");
  const { job, starting, error, start, cancel, reset } = useJob();

  const download = job?.download;
  const running =
    job != null && !["completed", "failed", "cancelled"].includes(job.status);

  // Fill the input when a Recent item is clicked (adjust state on prop change).
  const [seenPrefill, setSeenPrefill] = useState(prefillKey);
  if (prefillKey !== seenPrefill) {
    setSeenPrefill(prefillKey);
    if (prefillUrl) setUrl(prefillUrl);
  }

  // Save nice titles to Recent once yt-dlp reports them.
  const infoTitle = download?.info?.title;
  useEffect(() => {
    if (infoTitle && url) addRecent("download", url, infoTitle);
  }, [infoTitle, url]);

  const begin = () => {
    addRecent("download", url.trim());
    void start(() =>
      fetch("/api/jobs/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, format, settings: settings.download }),
      }),
    );
  };

  return (
    <div className="space-y-6">
      {/* URL input */}
      <div>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted">
          URL
        </label>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-1 focus-within:border-accent">
          <Link2 size={16} className="shrink-0 text-muted" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url && !running && begin()}
            placeholder="Paste YouTube / supported URL"
            disabled={running}
            className="w-full bg-transparent py-2.5 text-sm text-text outline-none placeholder:text-muted/60"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Try:</span>
          {EXAMPLE_URLS.download.map((ex) => (
            <button
              key={ex.url}
              type="button"
              disabled={running}
              onClick={() => setUrl(ex.url)}
              className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {/* Format selector */}
      <div>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted">
          Format
        </label>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={running}
              onClick={() => setFormat(f.id)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                format === f.id
                  ? "border-accent bg-accent-soft/60"
                  : "border-border bg-surface hover:border-border-strong"
              } ${running ? "opacity-60" : "cursor-pointer"}`}
            >
              <div className={format === f.id ? "text-accent" : "text-muted"}>{f.icon}</div>
              <div className="mt-2 text-sm font-semibold">{f.name}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted">{f.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Action */}
      {!job && (
        <button
          type="button"
          onClick={begin}
          disabled={!url.trim() || starting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={16} />
          {starting ? "Starting…" : "Download"}
        </button>
      )}

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Job card */}
      {job && (
        <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              {download?.info?.thumbnail && (
                <Image
                  src={download.info.thumbnail}
                  alt=""
                  width={112}
                  height={63}
                  unoptimized
                  className="h-16 w-28 shrink-0 rounded-lg border border-border object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {download?.info?.title ?? "Fetching info…"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {download?.info?.duration != null && (
                    <span className="font-mono">{formatTimestamp(download.info.duration)}</span>
                  )}
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono uppercase">
                    {download?.format}
                  </span>
                  {download?.info?.uploader && <span>{download.info.uploader}</span>}
                </div>
              </div>
            </div>
            <StatusBadge status={job.status} />
          </div>

          {running && (
            <>
              <ProgressBar value={download?.percent ?? 0} />
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="font-mono">{(download?.percent ?? 0).toFixed(1)}%</span>
                <span className="flex items-center gap-3">
                  {download?.speed && (
                    <span className="flex items-center gap-1 font-mono">
                      <Gauge size={12} /> {download.speed}
                    </span>
                  )}
                  {download?.eta && <span className="font-mono">ETA {download.eta}</span>}
                  {download?.statusText && <span>{download.statusText}</span>}
                </span>
              </div>
              <button
                type="button"
                onClick={cancel}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger"
              >
                <X size={14} /> Cancel
              </button>
            </>
          )}

          {job.status === "completed" && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href={`/api/jobs/${job.id}/file`}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-success px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                <Download size={15} />
                Download File
                {download?.fileSize != null && (
                  <span className="font-normal opacity-70">({formatBytes(download.fileSize)})</span>
                )}
              </a>
              <button
                type="button"
                onClick={reset}
                className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-muted hover:text-text"
              >
                <RotateCcw size={14} /> New Download
              </button>
            </div>
          )}

          {(job.status === "failed" || job.status === "cancelled") && (
            <div className="space-y-3">
              {job.error && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {job.error}
                </div>
              )}
              <button
                type="button"
                onClick={reset}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-muted hover:text-text"
              >
                <RotateCcw size={14} /> Try Again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
