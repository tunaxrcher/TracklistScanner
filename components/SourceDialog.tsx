"use client";

import { useState } from "react";
import { Check, Disc3, GripVertical, SquarePlay } from "lucide-react";
import type { SourcePrefs } from "@/lib/types";

type SourceId = "djpool" | "youtube";

const META: Record<SourceId, { label: string; icon: typeof Disc3; hint: string }> = {
  djpool: {
    label: "DJ Pool Records",
    icon: Disc3,
    hint: "Clean / DJ-ready versions from your pool subscription",
  },
  youtube: {
    label: "YouTube",
    icon: SquarePlay,
    hint: "Always available — converted to MP3 320 automatically",
  },
};

/**
 * Asks where to look for the detected tracks. One list does everything:
 * toggle a source on/off, drag to set the order it is tried in. Shown once
 * after the first scan; the choice is remembered and stays editable via the
 * "Sources" chip in the tracklist header.
 */
export function SourceDialog({
  initial,
  djPoolConfigured,
  onConfirm,
}: {
  initial: SourcePrefs;
  djPoolConfigured: boolean | null;
  onConfirm: (prefs: SourcePrefs, remember: boolean) => void;
}) {
  const [order, setOrder] = useState<SourceId[]>(
    initial.priority === "youtube" ? ["youtube", "djpool"] : ["djpool", "youtube"],
  );
  const [enabled, setEnabled] = useState<Record<SourceId, boolean>>({
    djpool: initial.djpool,
    youtube: initial.youtube,
  });
  const [remember, setRemember] = useState(true);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const isUnavailable = (id: SourceId) => id === "djpool" && djPoolConfigured === false;
  const isActive = (id: SourceId) => enabled[id] && !isUnavailable(id);
  const activeCount = order.filter(isActive).length;
  // Rank among *active* sources: 0 = tried first.
  const rankOf = (id: SourceId) => order.filter(isActive).indexOf(id);

  const move = (from: number, to: number) =>
    setOrder((o) => {
      const next = [...o];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  const confirm = () => {
    const first = order.find(isActive) ?? "djpool";
    onConfirm(
      {
        djpool: enabled.djpool && !isUnavailable("djpool"),
        youtube: enabled.youtube,
        priority: first === "youtube" ? "youtube" : "djpool",
      },
      remember,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl shadow-black/50">
        <h3 className="text-sm font-semibold">Where should tracks come from?</h3>
        <p className="mt-1 text-xs text-muted">
          Toggle sources on or off and drag to reorder — the top source is tried
          first, the next one fills in automatically when it has no match.
        </p>

        <div className="mt-5 space-y-2">
          {order.map((id, i) => {
            const { label, icon: Icon, hint } = META[id];
            const active = isActive(id);
            const unavailable = isUnavailable(id);
            const rank = active ? rankOf(id) : -1;
            return (
              <div
                key={id}
                draggable
                onDragStart={(e) => {
                  setDragIdx(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragIdx !== null && dragIdx !== i) {
                    move(dragIdx, i);
                    setDragIdx(i);
                  }
                }}
                onDragEnd={() => setDragIdx(null)}
                className={`flex w-full cursor-grab items-center gap-2.5 rounded-xl border px-3 py-3 transition-colors active:cursor-grabbing ${
                  active
                    ? "border-accent bg-accent-soft/60"
                    : "border-border bg-surface-2"
                } ${dragIdx === i ? "opacity-60" : ""}`}
              >
                <GripVertical size={15} className="shrink-0 text-muted/60" />
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    rank === 0
                      ? "bg-accent-gradient text-white"
                      : active
                        ? "bg-surface text-muted"
                        : "bg-surface text-muted/40"
                  }`}
                  title={rank === 0 ? "Tried first" : active ? `Fallback #${rank}` : "Off"}
                >
                  {active ? rank + 1 : "–"}
                </span>
                <Icon size={18} className={`shrink-0 ${active ? "text-accent" : "text-muted"}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {label}
                    {rank === 0 && activeCount > 1 && (
                      <span className="ml-2 rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                        first
                      </span>
                    )}
                    {unavailable && <span className="ml-2 text-[10px] text-muted">(not configured)</span>}
                  </div>
                  <div className="truncate text-[11px] text-muted">{hint}</div>
                </div>
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => setEnabled((s) => ({ ...s, [id]: !s[id] }))}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-40 ${
                    active ? "border-accent bg-accent text-white" : "border-border-strong"
                  }`}
                  aria-label={`${active ? "Disable" : "Enable"} ${label}`}
                >
                  {active && <Check size={12} />}
                </button>
              </div>
            );
          })}
        </div>

        <label className="mt-5 flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#f31260]"
          />
          Remember my choice (skip this next time)
        </label>

        <button
          type="button"
          disabled={activeCount === 0}
          onClick={confirm}
          className="mt-5 w-full rounded-xl bg-accent-gradient px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
