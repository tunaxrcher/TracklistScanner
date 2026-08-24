"use client";

import Image from "next/image";
import { useState } from "react";
import { Disc3, Download, Link2, Loader2, RotateCcw, Square } from "lucide-react";
import { useJob } from "@/lib/client/useJob";
import { ProgressBar, formatBytes } from "@/components/ui";
import type { DjDownloadFormat } from "@/lib/types";

const FORMATS: { id: DjDownloadFormat; label: string; hint: string }[] = [
  { id: "wav", label: "WAV", hint: "44.1 kHz / 16-bit — no extra quality loss, plays on any CDJ" },
  { id: "mp3", label: "MP3 320", hint: "320 kbps with title/artist tags — small and universal" },
];

const PHASE_LABEL: Record<string, string> = {
  queued: "Starting…",
  preparing: "Reading video info…",
  downloading: "Fetching best audio…",
  processing: "Converting…",
};

export function DownloadForDjPanel() {
  const { job, starting, error, start, cancel, reset } = useJob();
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<DjDownloadFormat>("wav");

  const state = job?.djdl;
  const running = job != null && !["completed", "failed", "cancelled"].includes(job.status);
  const completed = job?.status === "completed";
  const failed = job?.status === "failed" || job?.status === "cancelled";

  const begin = () => {
    void start(() =>
      fetch("/api/jobs/djdl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), format }),
      }),
    );
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Disc3 size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Download for DJ</h2>
            <p className="text-xs text-muted">
              Paste a YouTube link — get the highest-quality audio, ready to play.
            </p>
          </div>
        </div>

        {/* URL input */}
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 focus-within:border-accent/60">
          <Link2 size={15} className="shrink-0 text-muted" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim() && !running && !starting) begin();
            }}
            placeholder="https://www.youtube.com/watch?v=…"
            disabled={running}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted/50 disabled:opacity-50"
          />
        </div>

        {/* Format */}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={running}
              onClick={() => setFormat(f.id)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                format === f.id
                  ? "border-accent bg-accent-soft/60"
                  : "border-border bg-surface-2 hover:border-border-strong"
              }`}
            >
              <div className="text-sm font-semibold">{f.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted">{f.hint}</div>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="mt-5 flex items-center gap-2">
          {!running && (
            <button
              type="button"
              onClick={begin}
              disabled={!url.trim() || starting}
              className="flex items-center gap-2 rounded-xl bg-accent-gradient px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {starting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              Get audio
            </button>
          )}
          {running && (
            <button
              type="button"
              onClick={() => void cancel()}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-5 py-2.5 text-sm font-medium text-muted transition-colors hover:text-text"
            >
              <Square size={13} /> Stop
            </button>
          )}
          {job && !running && (
            <button
              type="button"
              onClick={() => {
                reset();
                setUrl("");
              }}
              className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:text-text"
            >
              <RotateCcw size={13} /> New
            </button>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        {failed && job?.error && <p className="mt-4 text-sm text-danger">{job.error}</p>}

        {/* Progress / result */}
        {job && state && !failed && (
          <div className="mt-6 rounded-xl border border-border bg-surface-2 p-4">
            <div className="flex items-center gap-3">
              {state.info?.thumbnail && (
                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-border">
                  <Image src={state.info.thumbnail} alt="" fill unoptimized sizes="96px" className="object-cover" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={state.info?.title}>
                  {state.info?.title ?? state.url}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {state.info?.uploader}
                  {state.info?.uploader && " · "}
                  {state.format.toUpperCase()}
                </div>
              </div>
            </div>

            {running && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    {PHASE_LABEL[job.status] ?? "Working…"}
                  </span>
                  {job.status === "downloading" && <span>{state.downloadProgress}%</span>}
                </div>
                <ProgressBar
                  value={job.status === "processing" ? 100 : state.downloadProgress}
                  active={running}
                />
              </div>
            )}

            {completed && state.fileName && (
              <a
                href={`/api/jobs/${job.id}/file`}
                className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-success px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <Download size={15} />
                Save {state.fileName}
                {state.fileSize ? ` (${formatBytes(state.fileSize)})` : ""}
              </a>
            )}
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-muted/70">
        YouTube serves audio at ~130–160 kbps Opus. WAV keeps every bit of that without
        another lossy encode; MP3 320 re-encodes once for smaller, tagged files.
      </p>
    </div>
  );
}
