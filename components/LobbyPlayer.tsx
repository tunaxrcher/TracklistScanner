"use client";

import { useRef, useState } from "react";
import { AudioLines, Pause, Play } from "lucide-react";
import { formatTimestamp } from "@/lib/tracklist";

/**
 * Decorative looping player pinned to the bottom of the login page.
 * Plays /lobby.mp3 when that file exists in /public; otherwise the bar
 * still renders but the play button stays disabled.
 */
export function LobbyPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [available, setAvailable] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setAvailable(false));
    else audio.pause();
  };

  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-surface/90 backdrop-blur-md">
      <div className="h-0.5 w-full bg-accent-gradient" />
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 lg:px-8">
        <audio
          ref={audioRef}
          src="/lobby.mp3"
          loop
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onError={() => setAvailable(false)}
        />

        <button
          type="button"
          onClick={toggle}
          disabled={!available}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-gradient text-white shadow-lg shadow-accent/30 transition-transform hover:scale-105 disabled:opacity-30 disabled:hover:scale-100"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>

        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <AudioLines size={14} className={playing ? "text-accent" : ""} />
          <span className="truncate">{available ? "Lobby mix" : "Music unavailable"}</span>
        </div>

        <div className="hidden flex-1 items-center gap-3 sm:flex">
          <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted">
            {formatTimestamp(time)}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent-gradient" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-10 shrink-0 font-mono text-[11px] text-muted">
            {duration ? formatTimestamp(duration) : "--:--"}
          </span>
        </div>
      </div>
    </div>
  );
}
