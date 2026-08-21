"use client";

import { useEffect, useState } from "react";
import { AudioLines, Download, ListMusic, Settings, TriangleAlert } from "lucide-react";
import { DownloadPanel } from "@/components/DownloadPanel";
import { TracklistPanel } from "@/components/TracklistPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { RecentSidebar } from "@/components/RecentSidebar";
import { useSettings } from "@/lib/client/settings";
import type { RecentItem } from "@/lib/client/recent";

type Tab = "download" | "tracklist";

interface Health {
  ytDlp: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  acrCloud: boolean;
  djPool: boolean;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("download");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useSettings();
  const [health, setHealth] = useState<Health | null>(null);
  const [prefill, setPrefill] = useState<{ tab: Tab; url: string; key: number } | null>(null);

  const onSelectRecent = (item: RecentItem) => {
    setTab(item.kind);
    setPrefill({ tab: item.kind, url: item.url, key: Date.now() });
  };

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
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-8 lg:px-8 lg:py-12">
      {/* Header */}
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <AudioLines size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              Audio Downloader <span className="text-muted">&</span> Tracklist Scanner
            </h1>
            <p className="text-xs text-muted">yt-dlp · FFmpeg · Shazam · ACRCloud</p>
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

      <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-6">
        {/* Recent sidebar */}
        <div className="mb-6 lg:mb-0">
          <RecentSidebar onSelect={onSelectRecent} />
        </div>

        <div>
          {/* Tabs */}
          <nav className="mb-6 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-surface p-1.5">
            {(
              [
                { id: "download", label: "Download", icon: <Download size={15} /> },
                { id: "tracklist", label: "Tracklist", icon: <ListMusic size={15} /> },
              ] as { id: Tab; label: string; icon: React.ReactNode }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold uppercase tracking-wide transition-colors ${
                  tab === t.id ? "bg-accent text-white" : "text-muted hover:text-text"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>

          {/* Panels stay mounted so switching tabs never interrupts a running job */}
          <main className="rounded-2xl border border-border bg-surface/50 p-5 lg:p-7">
            <div className={tab === "download" ? "" : "hidden"}>
              <DownloadPanel
                settings={settings}
                prefillUrl={prefill?.tab === "download" ? prefill.url : undefined}
                prefillKey={prefill?.tab === "download" ? prefill.key : undefined}
              />
            </div>
            <div className={tab === "tracklist" ? "" : "hidden"}>
              <TracklistPanel
                settings={settings}
                djPoolConfigured={health?.djPool ?? null}
                prefillUrl={prefill?.tab === "tracklist" ? prefill.url : undefined}
                prefillKey={prefill?.tab === "tracklist" ? prefill.key : undefined}
              />
            </div>
          </main>
        </div>
      </div>

      <footer className="mt-8 text-center text-xs text-muted/60">
        Download = get the audio file · Tracklist = find out which songs are inside
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
