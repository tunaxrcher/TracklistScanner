"use client";

import { useEffect, useState } from "react";
import { AudioLines, Settings, TriangleAlert } from "lucide-react";
import { TracklistPanel } from "@/components/TracklistPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { useSettings } from "@/lib/client/settings";

interface Health {
  ytDlp: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  acrCloud: boolean;
  djPool: boolean;
}

export default function Home() {
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useSettings();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const check = async () => {
      try {
        const res = await fetch("/api/health");
        const data = (await res.json()) as Health;
        if (stopped) return;
        setHealth(data);
        // Keep re-checking while something is missing, so installing a
        // dependency clears the warning without a manual page reload.
        if (!data.ytDlp || !data.ffmpeg || !data.ffprobe) {
          timer = setTimeout(check, 15_000);
        }
      } catch {
        if (!stopped) timer = setTimeout(check, 15_000);
      }
    };

    check();
    const onFocus = () => {
      if (timer) clearTimeout(timer);
      check();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const missing: string[] = [];
  if (health && !health.ytDlp) missing.push("yt-dlp");
  if (health && (!health.ffmpeg || !health.ffprobe)) missing.push("FFmpeg");

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-8 lg:px-8 lg:py-10">
      {/* Header */}
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-gradient text-white">
            <AudioLines size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Tracklist Scanner</h1>
            {/* <p className="text-xs text-muted">yt-dlp · FFmpeg · Shazam · ACRCloud · DJ Pool</p> */}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-text"
          aria-label="Settings"
        >
          <Settings size={16} />
        </button>
      </header>

      {missing.length > 0 && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
          <TriangleAlert size={15} className="shrink-0" />
          Missing dependencies: {missing.join(", ")}. Install them and restart the server.
        </div>
      )}

      <main>
        <TracklistPanel
          settings={settings}
          djPoolConfigured={health?.djPool ?? null}
          acrConfigured={health?.acrCloud ?? null}
        />
      </main>

      <footer className="mt-10 text-center text-xs text-muted/60">
        {/* Scan any URL or file to find out which songs are inside — then grab them from DJ Pool. */}
      </footer>

      {showSettings && (
        <SettingsModal
          settings={settings}
          acrConfigured={health?.acrCloud ?? null}
          djPoolConfigured={health?.djPool ?? null}
          onSave={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
