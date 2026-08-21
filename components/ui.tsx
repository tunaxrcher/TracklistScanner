"use client";

import type { JobStatus } from "@/lib/types";
import { Loader2 } from "lucide-react";

export function ProgressBar({ value, active = true }: { value: number; active?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={`h-full rounded-full bg-accent-gradient transition-[width] duration-300 ${active ? "" : "opacity-60"}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-border-strong"
      } ${disabled ? "opacity-40" : "cursor-pointer"}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-20 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-right text-sm text-text outline-none focus:border-accent"
      />
      {suffix && <span className="text-xs text-muted">{suffix}</span>}
    </div>
  );
}

export function Stat({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-lg font-semibold text-text ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

const STATUS_STYLES: Record<JobStatus, { label: string; className: string; spin?: boolean }> = {
  queued: { label: "Queued", className: "text-muted border-border", spin: true },
  preparing: { label: "Preparing", className: "text-amber-300 border-amber-300/30", spin: true },
  downloading: { label: "Downloading", className: "text-sky-300 border-sky-300/30", spin: true },
  sampling: { label: "Sampling", className: "text-violet-300 border-violet-300/30", spin: true },
  recognizing: { label: "Recognizing", className: "text-violet-300 border-violet-300/30", spin: true },
  matching: { label: "Matching", className: "text-sky-300 border-sky-300/30", spin: true },
  processing: { label: "Processing", className: "text-sky-300 border-sky-300/30", spin: true },
  completed: { label: "Completed", className: "text-success border-success/30" },
  failed: { label: "Failed", className: "text-danger border-danger/30" },
  cancelled: { label: "Stopped", className: "text-muted border-border" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-surface-2 px-2.5 py-1 text-xs font-medium ${style.className}`}
    >
      {style.spin && <Loader2 size={12} className="animate-spin" />}
      {style.label}
    </span>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(1)} ${units[i]}`;
}
