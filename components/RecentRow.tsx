"use client";

import Image from "next/image";
import { ListMusic, Trash2, X } from "lucide-react";
import { clearRecent, removeRecent, useRecent, type RecentItem } from "@/lib/client/recent";
import { youtubeThumb } from "@/lib/client/youtube";

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
}: {
  onSelect: (item: RecentItem) => void;
  disabled?: boolean;
}) {
  const items = useRecent();
  if (items.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="border-b-2 border-accent pb-1 text-sm font-semibold text-accent">Recent</h2>
        <button
          type="button"
          onClick={clearRecent}
          className="flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-danger"
        >
          <Trash2 size={12} /> Clear
        </button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        {items.map((item) => {
          const thumb = youtubeThumb(item.url);
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
              <button
                type="button"
                onClick={() => removeRecent(item.url)}
                className="absolute right-1.5 top-1.5 hidden rounded-full bg-black/60 p-1 text-white/80 transition-colors hover:text-danger group-hover:block"
                title="Remove"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
