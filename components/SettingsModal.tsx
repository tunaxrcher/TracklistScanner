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

function StatusChip({ label, ok }: { label: string; ok: boolean | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          ok == null ? "bg-border-strong" : ok ? "bg-success" : "bg-danger"
        }`}
      />
      {label}
      {ok === false && <span className="text-danger">not configured</span>}
    </span>
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
          <button type="button" onClick={onClose} aria-label="Close settings" className="text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Read-only service status */}
          <div className="flex flex-wrap gap-2">
            <StatusChip label="Shazam" ok />
            <StatusChip label="ACRCloud" ok={acrConfigured} />
            <StatusChip label="DJ Pool" ok={djPoolConfigured} />
          </div>

          <Section title='Custom Scan Mode'>
            <p className="text-xs leading-relaxed text-muted">
              Only used when scanning with the <span className="font-medium text-text/80">Custom</span> preset
              — Fast and Thorough set these automatically.
            </p>
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
            <Row label="Smart Scan" hint="Fewer samples while the same song plays">
              <Toggle checked={draft.scan.smartScan} onChange={(v) => scan({ smartScan: v })} />
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
          {/* <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-muted hover:text-text"
          >
            Cancel
          </button> */}
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="flex-1 rounded-xl bg-accent-gradient px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
