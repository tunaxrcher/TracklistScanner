"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import type { TrackEntry } from "@/lib/types";
import {
  DEFAULT_EXPORT_OPTIONS,
  exportCsv,
  exportJson,
  exportTxt,
  type ExportOptions,
} from "@/lib/tracklist";

type ExportFormat = "txt" | "csv" | "json";

const OPTION_LABELS: { key: keyof ExportOptions; label: string }[] = [
  { key: "includeTimestamps", label: "Include timestamps" },
  { key: "includeArtist", label: "Include artist" },
  { key: "includeFilename", label: "Include filename" },
  { key: "removeDuplicates", label: "Remove duplicates" },
];

export function ExportDialog({
  tracks,
  onClose,
}: {
  tracks: TrackEntry[];
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("txt");
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);

  const doExport = () => {
    const content =
      format === "txt"
        ? exportTxt(tracks, options)
        : format === "csv"
          ? exportCsv(tracks, options)
          : exportJson(tracks, options);
    const mime = format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/plain";
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tracklist.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Export Tracklist</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-text">
            <X size={16} />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          {(["txt", "csv", "json"] as ExportFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase transition-colors ${
                format === f
                  ? "border-accent bg-accent-soft/60 text-text"
                  : "border-border bg-surface-2 text-muted hover:text-text"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="mb-5 space-y-2.5">
          {OPTION_LABELS.map(({ key, label }) => (
            <label key={key} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOptions({ ...options, [key]: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-[#7c6cf6]"
              />
              <span className="text-text/90">{label}</span>
            </label>
          ))}
        </div>

        <button
          type="button"
          onClick={doExport}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          <Download size={15} /> Export {format.toUpperCase()}
        </button>
      </div>
    </div>
  );
}
