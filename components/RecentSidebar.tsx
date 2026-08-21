"use client";

import { Clock, Download, ListMusic, Trash2, X } from "lucide-react";
import { clearRecent, removeRecent, useRecent, type RecentItem } from "@/lib/client/recent";

function relativeTime(at: number): string {
  const diff = Date.now() - at;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

export function RecentSidebar({ onSelect }: { onSelect: (item: RecentItem) => void }) {
  const items = useRecent();

  return (
    <aside className="lg:sticky lg:top-6">
      <div className="rounded-2xl border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <Clock size={13} /> Recent
          </h2>
          {items.length > 0 && (
            <button
              type="button"
              onClick={clearRecent}
              className="flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-danger"
              title="Clear all"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted/70">
            Your recent URLs will appear here.
          </p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={`${item.kind}:${item.url}`} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <span
                    className={`mt-0.5 shrink-0 ${
                      item.kind === "download" ? "text-sky-300" : "text-violet-300"
                    }`}
                  >
                    {item.kind === "download" ? <Download size={14} /> : <ListMusic size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text/90">
                      {item.title ?? item.url}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">
                      <span className="capitalize">{item.kind}</span>
                      <span>·</span>
                      <span>{relativeTime(item.at)}</span>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeRecent(item.kind, item.url)}
                  className="absolute right-1.5 top-1.5 hidden rounded p-1 text-muted transition-colors hover:text-danger group-hover:block"
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
