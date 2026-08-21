/**
 * Diagnostic: why does the 06:36–09:03 slot (Xis - ข่าวลือ) come back empty?
 *
 * Downloads that window of the video, then asks BOTH providers at every
 * 10-second offset (denser than the real scanner) and prints what each says.
 *
 * Run: npx tsx scripts/analyze-gap.ts
 */
import { readFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "fs";
import path from "path";
import { run } from "@/lib/server/proc";
import { resolveYtDlp, resolveFfmpeg } from "@/lib/server/bin";
import { extractSampleWav } from "@/lib/server/ffmpeg";
import { recognizeWithShazam } from "@/lib/server/recognition/shazam";
import { recognizeWithAcrCloud } from "@/lib/server/recognition/acrcloud";

const VIDEO = "https://youtu.be/rC1rRZszJ1Y";
// Absolute window in the video (official slot is 396s–543s, take margin).
const WINDOW_START = 380;
const WINDOW_END = 555;
const STEP = 10;
const SAMPLE_SEC = 12;

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

function fmt(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  loadEnvLocal();
  const tmp = path.join(process.cwd(), "scripts", ".gap-tmp");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  console.log(`Downloading ${fmt(WINDOW_START)}–${fmt(WINDOW_END)} of ${VIDEO} ...`);
  const { code, stderr } = await run(resolveYtDlp(), [
    "--no-playlist", "--no-warnings",
    "--ffmpeg-location", resolveFfmpeg(),
    "-f", "bestaudio/best",
    "--download-sections", `*${WINDOW_START}-${WINDOW_END}`,
    "-o", path.join(tmp, "seg.%(ext)s"),
    "--", VIDEO,
  ]);
  if (code !== 0) throw new Error(`yt-dlp failed: ${stderr.slice(0, 600)}`);
  const segFile = readdirSync(tmp).find((f) => f.startsWith("seg."));
  if (!segFile) throw new Error("segment file missing");
  const segPath = path.join(tmp, segFile);
  console.log(`Segment ready: ${segFile}\n`);
  console.log("abs time | Shazam                                   | ACRCloud");
  console.log("---------|------------------------------------------|------------------------------------------");

  for (let abs = WINDOW_START + 10; abs + SAMPLE_SEC <= WINDOW_END; abs += STEP) {
    const rel = abs - WINDOW_START;
    const wav = path.join(tmp, `s-${abs}.wav`);
    await extractSampleWav(segPath, rel, SAMPLE_SEC, wav);

    let shazam = "";
    try {
      const r = await recognizeWithShazam(wav);
      shazam = r ? `${r.title} — ${r.artist}` : "(no match)";
    } catch (e) {
      shazam = `ERROR: ${e instanceof Error ? e.message : e}`;
    }

    let acr = "";
    try {
      const r = await recognizeWithAcrCloud(wav);
      acr = r ? `${r.title} — ${r.artist}` : "(no match)";
    } catch (e) {
      acr = `ERROR: ${e instanceof Error ? e.message : e}`;
    }

    console.log(`${fmt(abs).padEnd(8)} | ${shazam.slice(0, 40).padEnd(40)} | ${acr.slice(0, 40)}`);
    await sleep(1500);
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
