"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { AppSettings } from "@/lib/client/settings";
import { NumberField, Toggle } from "@/components/ui";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h4>
      <div className="space-y-3 rounded-xl border border-border bg-surface-2/50 p-4">{children}</div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm text-text/90">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsModal({
  settings,
  acrConfigured,
  djPoolConfigured,
  onSave,
  onClose,
}: {
  settings: AppSettings;
  acrConfigured: boolean | null;
  djPoolConfigured: boolean | null;
  onSave: (next: AppSettings) => void;
  onClose: () => void;
}) {
  // The modal is mounted fresh each time it opens, so initial state is enough.
  const [draft, setDraft] = useState<AppSettings>(settings);

  const scan = (patch: Partial<AppSettings["scan"]>) =>
    setDraft((d) => ({ ...d, scan: { ...d.scan, ...patch } }));
  const download = (patch: Partial<AppSettings["download"]>) =>
    setDraft((d) => ({ ...d, download: { ...d.download, ...patch } }));
  const djpool = (patch: Partial<AppSettings["djpool"]>) =>
    setDraft((d) => ({ ...d, djpool: { ...d.djpool, ...patch } }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold">Settings</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          <Section title="Recognition">
            <Row label="Shazam" hint="Primary recognition provider">
              <Toggle checked={draft.scan.useShazam} onChange={(v) => scan({ useShazam: v })} />
            </Row>
            <Row
              label="ACRCloud Fallback"
              hint={
                acrConfigured === false
                  ? "Not configured — set ACR_* keys in .env.local"
                  : "Used only when Shazam finds nothing"
              }
            >
              <Toggle checked={draft.scan.useAcrCloud} onChange={(v) => scan({ useAcrCloud: v })} />
            </Row>
          </Section>

          <Section title="Scanning">
            <Row label="Scan Interval" hint="Gap between sample positions">
              <NumberField
                value={draft.scan.scanInterval}
                onChange={(v) => scan({ scanInterval: v })}
                min={10}
                max={600}
                step={5}
                suffix="sec"
              />
            </Row>
            <Row label="Sample Duration" hint="Audio length sent to recognition">
              <NumberField
                value={draft.scan.sampleDuration}
                onChange={(v) => scan({ sampleDuration: v })}
                min={5}
                max={20}
                suffix="sec"
              />
            </Row>
            <Row label="Smart Scan" hint="Fewer samples while the same song plays">
              <Toggle checked={draft.scan.smartScan} onChange={(v) => scan({ smartScan: v })} />
            </Row>
          </Section>

          <Section title="Duplicate Detection">
            <Row label="Merge Same Song Within" hint="Consecutive detections become one row">
              <NumberField
                value={draft.scan.mergeWindow}
                onChange={(v) => scan({ mergeWindow: v })}
                min={0}
                max={3600}
                step={10}
                suffix="sec"
              />
            </Row>
          </Section>

          <Section title="Download">
            <Row label="MP3 Quality">
              <select
                value={draft.download.mp3Quality}
                onChange={(e) => download({ mp3Quality: Number(e.target.value) })}
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
              >
                {[320, 256, 192, 128].map((q) => (
                  <option key={q} value={q}>
                    {q} kbps
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Keep Temporary Files" hint="Skip auto-cleanup of /temp/jobs">
              <Toggle
                checked={draft.download.keepTempFiles && draft.scan.keepTempFiles}
                onChange={(v) => {
                  download({ keepTempFiles: v });
                  scan({ keepTempFiles: v });
                }}
              />
            </Row>
          </Section>

          <Section title="DJ Pool Records">
            {djPoolConfigured === false && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
                Account not configured — set DJPOOL_EMAIL and DJPOOL_PASSWORD in .env.local.
              </div>
            )}
            <Row label="Preferred Version" hint="Which explicit/clean variant to pick">
              <select
                value={draft.djpool.versionPreference}
                onChange={(e) =>
                  djpool({ versionPreference: e.target.value as AppSettings["djpool"]["versionPreference"] })
                }
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
              >
                <option value="either">Either</option>
                <option value="clean">Clean</option>
                <option value="dirty">Dirty / Explicit</option>
              </select>
            </Row>
            <Row label="Avoid Acapella" hint="Skip vocal-only files">
              <Toggle checked={draft.djpool.avoidAcapella} onChange={(v) => djpool({ avoidAcapella: v })} />
            </Row>
            <Row label="Avoid Instrumental" hint="Skip music-only files">
              <Toggle checked={draft.djpool.avoidInstrumental} onChange={(v) => djpool({ avoidInstrumental: v })} />
            </Row>
            <Row label="Avoid Intro/Outro Edits" hint="Prefer the full track">
              <Toggle checked={draft.djpool.avoidIntroOutro} onChange={(v) => djpool({ avoidIntroOutro: v })} />
            </Row>
            <Row label="Avoid Remixes" hint="Unless the detected title asks for one">
              <Toggle checked={draft.djpool.avoidRemix} onChange={(v) => djpool({ avoidRemix: v })} />
            </Row>
          </Section>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-muted hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
