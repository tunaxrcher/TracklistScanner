/**
 * Full-fidelity scan test: runs the REAL scanner pipeline (YouTubeAudioSource
 * + scanAudioSource, thorough preset) against the KAMIKAZE mix to observe
 * per-sample provider answers and the gap-fill pass end to end.
 *
 * Run: $env:SCAN_DEBUG=1; npx tsx scripts/scan-test.ts
 */
import { readFileSync, mkdirSync, rmSync, existsSync } from "fs";
import path from "path";
import { YouTubeAudioSource } from "@/lib/server/audio/YouTubeAudioSource";
import { scanAudioSource } from "@/lib/server/scanner/scanner";
import { DEFAULT_SCAN_SETTINGS } from "@/lib/types";
import { formatTimestamp } from "@/lib/tracklist";

const VIDEO = "https://youtu.be/rC1rRZszJ1Y";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

async function main() {
  loadEnvLocal();
  process.env.SCAN_DEBUG = "1";
  const tmp = path.join(process.cwd(), "scripts", ".scan-tmp");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  // Same as the Thorough preset in the UI.
  const settings = { ...DEFAULT_SCAN_SETTINGS, smartScan: false, scanInterval: 20 };

  const source = new YouTubeAudioSource(VIDEO, tmp);
  console.log("Preparing source (download audio)...");
  await source.prepare({
    onPrepareProgress: (p, s) => {
      if (p === 0 || p === 100 || p % 25 === 0) console.log(`  prepare ${p}% ${s ?? ""}`);
    },
  });
  console.log("Scanning...");

  const { tracks, samplesFailed } = await scanAudioSource(source, 0, settings, {}, {
    onProgress: () => {},
    onTrack: (t) => console.log(`  + TRACK ${formatTimestamp(t.timestamp)} ${t.title} — ${t.artist} [${t.provider}]`),
    onTrackUpdated: () => {},
  });

  console.log(`\n===== RESULT (${tracks.length} tracks, ${samplesFailed} failed samples) =====`);
  for (const t of tracks) {
    console.log(`${formatTimestamp(t.timestamp)}–${formatTimestamp(t.lastSeen)}  ${t.title} — ${t.artist} [${t.provider}]`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
