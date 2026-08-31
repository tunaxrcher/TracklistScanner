"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { AudioLines, Disc3, ListMusic, LogOut, Settings, TriangleAlert } from "lucide-react";
import { TracklistPanel } from "@/components/TracklistPanel";
import { DownloadForDjPanel } from "@/components/DownloadForDjPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { useSettings } from "@/lib/client/settings";

interface Health {
  ytDlp: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  acrCloud: boolean;
  djPool: boolean;
}

interface Me {
  email: string;
  name?: string;
  picture?: string;
}

type Tab = "tracklist" | "djdl";

const TABS: { id: Tab; label: string; icon: typeof ListMusic }[] = [
  { id: "tracklist", label: "Tracklist", icon: ListMusic },
  { id: "djdl", label: "Download for DJ", icon: Disc3 },
];

export default function Home() {
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useSettings();
  const [health, setHealth] = useState<Health | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [userMenu, setUserMenu] = useState(false);
  const [tab, setTab] = useState<Tab>("tracklist");

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

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user: Me | null } | null) => setMe(data?.user ?? null))
      .catch(() => {});
  }, []);

  const missing: string[] = [];
  if (health && !health.ytDlp) missing.push("yt-dlp");
  if (health && (!health.ffmpeg || !health.ffprobe)) missing.push("FFmpeg");

  return (
    <div className="mx-auto min-h-screen max-w-[90rem] px-4 py-8 lg:px-8 lg:py-10">
      {/* Header */}
      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-gradient text-white">
            <AudioLines size={20} />
          </div>
          <h1 className="hidden text-lg font-semibold leading-tight sm:block">Tracklist Scanner</h1>
        </div>

        {/* Tabs */}
        <nav className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                tab === id ? "bg-accent-gradient text-white" : "text-muted hover:text-text"
              }`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-text"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>

          {/* User menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setUserMenu((v) => !v)}
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface"
              aria-label="Account"
            >
              {me?.picture ? (
                // no-referrer: Google serves avatars with a 403 for some
                // accounts when a cross-site Referer header is attached.
                <Image
                  src={me.picture}
                  alt=""
                  width={36}
                  height={36}
                  unoptimized
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs font-semibold text-muted">
                  {(me?.name ?? me?.email ?? "?").slice(0, 1).toUpperCase()}
                </span>
              )}
            </button>
            {userMenu && (
              <div className="absolute right-0 top-11 z-30 w-56 rounded-xl border border-border bg-surface p-2 shadow-2xl shadow-black/50">
                <div className="border-b border-border px-3 pb-2 pt-1">
                  <div className="truncate text-sm font-medium">{me?.name ?? "Signed in"}</div>
                  <div className="truncate text-xs text-muted">{me?.email}</div>
                </div>
                <form method="POST" action="/api/auth/signout">
                  <button
                    type="submit"
                    className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </header>

      {missing.length > 0 && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
          <TriangleAlert size={15} className="shrink-0" />
          Missing dependencies: {missing.join(", ")}. Install them and restart the server.
        </div>
      )}

      <main>
        <div className={tab === "tracklist" ? "" : "hidden"}>
          <TracklistPanel
            settings={settings}
            djPoolConfigured={health?.djPool ?? null}
            acrConfigured={health?.acrCloud ?? null}
          />
        </div>
        {tab === "djdl" && <DownloadForDjPanel />}
      </main>

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
