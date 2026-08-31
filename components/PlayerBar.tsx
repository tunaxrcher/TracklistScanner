"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Loader2, Music2, Pause, Play, X } from "lucide-react";
import { formatTimestamp } from "@/lib/tracklist";

export interface NowPlaying {
  /** TrackEntry id when played from the tracklist (used to highlight the row). */
  trackId?: string;
  name: string;
  subtitle?: string;
  cover?: string;
  src: string;
}

/**
 * Bottom player for previewing DJ Pool files.
 * Mount with key={track.src} so internal state resets per song.
 */
export function PlayerBar({ track, onClose }: { track: NowPlaying; onClose: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-surface/95 shadow-[0_-8px_30px_rgba(0,0,0,0.5)] backdrop-blur-md">
      <div className="h-0.5 w-full bg-accent-gradient" />
      <div className="mx-auto flex max-w-[90rem] items-center gap-4 px-4 py-3.5 sm:gap-6 lg:px-8">
        <audio
          ref={audioRef}
          src={track.src}
          autoPlay
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onCanPlay={() => setReady(true)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onError={() => setError(true)}
        />

        {/* Track info */}
        <div className="flex w-full min-w-0 items-center gap-3 sm:w-72 sm:shrink-0">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2">
            {track.cover ? (
              <Image src={track.cover} alt="" fill unoptimized sizes="48px" className="object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-accent">
                <Music2 size={18} />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold" title={track.name}>
              {track.name}
            </div>
            <div className="truncate text-xs text-muted">
              {error ? (
                <span className="text-danger">Playback failed</span>
              ) : (
                track.subtitle ?? "DJ Pool preview"
              )}
            </div>
          </div>
        </div>

        {/* Play / pause */}
        <button
          type="button"
          onClick={toggle}
          disabled={error}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-gradient text-white shadow-lg shadow-accent/30 transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
          aria-label={playing ? "Pause" : "Play"}
        >
          {!ready && !error ? (
            <Loader2 size={17} className="animate-spin" />
          ) : playing ? (
            <Pause size={17} />
          ) : (
            <Play size={17} className="ml-0.5" />
          )}
        </button>

        {/* Progress */}
        <div className="hidden flex-1 items-center gap-3 sm:flex">
          <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted">
            {formatTimestamp(time)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={Math.min(time, duration || 0)}
            onChange={(e) => {
              const audio = audioRef.current;
              if (audio) audio.currentTime = Number(e.target.value);
            }}
            disabled={!duration}
            className="player-range w-full"
            style={{
              background: `linear-gradient(to right, #ef1257 0%, #ff0f9a ${pct}%, var(--color-surface-2) ${pct}%)`,
            }}
          />
          <span className="w-10 shrink-0 font-mono text-[11px] text-muted">
            {duration ? formatTimestamp(duration) : "--:--"}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-2 text-muted transition-colors hover:text-text"
          aria-label="Close player"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
