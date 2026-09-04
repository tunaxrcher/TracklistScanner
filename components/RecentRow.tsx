"use client";

import Image from "next/image";
import { useState } from "react";
import { FileAudio, FolderOpen, Globe, ListMusic, Trash2, X } from "lucide-react";
import { clearRecent, removeRecent, useRecent, type RecentItem } from "@/lib/client/recent";
import { youtubeThumb } from "@/lib/client/youtube";

const KIND_BADGE = {
  url: { label: "URL", icon: <Globe size={9} /> },
  file: { label: "Audio", icon: <FileAudio size={9} /> },
  folder: { label: "Folder", icon: <FolderOpen size={9} /> },
} as const;

function relativeTime(at: number): string {
  const diff = Date.now() - at;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Horizontal "Recently Played"-style card row of past scan URLs. */
export function RecentRow({
  onSelect,
  disabled,
  activeUrl,
}: {
  onSelect: (item: RecentItem) => void;
  disabled?: boolean;
  /** Source currently on screen / being scanned — Clear leaves it alone. */
  activeUrl?: string;
}) {
  const items = useRecent();
  const [confirming, setConfirming] = useState(false);
  console.warn(`[recent-debug] RecentRow render items=${items.length}`);
  if (items.length === 0) return null;

  const keep = activeUrl && items.some((i) => i.url === activeUrl) ? activeUrl : undefined;
  const clearable = keep ? items.length - 1 : items.length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="border-b-2 border-accent pb-1 text-sm font-semibold text-accent">Recent</h2>
        <div className="relative">
          <button
            type="button"
            onClick={() => setConfirming((v) => !v)}
            disabled={clearable === 0}
            aria-expanded={confirming}
            className={`flex items-center gap-1 text-[11px] transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 ${
              confirming ? "text-danger" : "text-muted"
            }`}
            title={clearable === 0 ? "Only the tracklist on screen is here" : "Remove history (the tracklist on screen stays)"}
          >
            <Trash2 size={12} /> Clear
          </button>
          {confirming && (
            <div className="absolute right-0 top-6 z-30 w-60 rounded-xl border border-border bg-surface p-3 shadow-2xl shadow-black/50">
              <p className="text-xs text-text">
                Remove {clearable} {clearable === 1 ? "item" : "items"} from Recent?
              </p>
              {keep && <p className="mt-1 text-[11px] text-muted">The tracklist on screen stays.</p>}
              <div className="mt-2.5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-text"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearRecent(keep);
                    setConfirming(false);
                  }}
                  className="rounded-lg bg-danger px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        {items.map((item) => {
          const thumb = youtubeThumb(item.url);
          const badge = KIND_BADGE[item.kind ?? "url"];
          return (
            <div key={item.url} className="group relative w-40 shrink-0">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(item)}
                className="w-full text-left disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-surface-2">
                  {thumb ? (
                    <Image
                      src={thumb}
                      alt=""
                      fill
                      unoptimized
                      sizes="160px"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted">
                      <ListMusic size={20} />
                    </div>
                  )}
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/85 backdrop-blur-sm">
                    {badge.icon}
                    {badge.label}
                  </span>
                </div>
                <div className="mt-2 line-clamp-2 text-xs font-medium leading-snug text-text/90">
                  {item.title ?? item.url}
                </div>
                <div className="mt-0.5 text-[10px] text-muted">
                  {item.tracks && item.tracks.length > 0 && (
                    <span className="font-medium text-accent">{item.tracks.length} tracks · </span>
                  )}
                  {relativeTime(item.at)}
                </div>
              </button>
              {item.url !== keep && (
                <button
                  type="button"
                  onClick={() => removeRecent(item.url)}
                  className="absolute right-1.5 top-1.5 hidden rounded-full bg-black/60 p-1 text-white/80 transition-colors hover:text-danger group-hover:block"
                  title="Remove"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
