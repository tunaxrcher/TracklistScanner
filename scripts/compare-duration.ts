/**
 * Does sample duration decide whether Shazam matches Xis - ข่าวลือ in the mix?
 * Tests 10s vs 12s vs 14s samples at the same positions.
 *
 * Run: npx tsx scripts/compare-duration.ts
 */
import { readFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "fs";
import path from "path";
import { run } from "@/lib/server/proc";
import { resolveYtDlp, resolveFfmpeg } from "@/lib/server/bin";
import { extractSampleWav } from "@/lib/server/ffmpeg";
import { recognizeWithShazam } from "@/lib/server/recognition/shazam";

const VIDEO = "https://youtu.be/rC1rRZszJ1Y";
const WINDOW_START = 380;
const WINDOW_END = 555;
const POSITIONS = [430, 450, 470, 490];
const DURATIONS = [10, 12, 14];

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  loadEnvLocal();
  const tmp = path.join(process.cwd(), "scripts", ".dur-tmp");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  console.log("Downloading segment...");
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
  if (!segFile) throw new Error("segment missing");
  const segPath = path.join(tmp, segFile);

  console.log("pos  | dur | shazam answer");
  console.log("-----|-----|-----------------------------");
  for (const abs of POSITIONS) {
    for (const dur of DURATIONS) {
      const wav = path.join(tmp, `s-${abs}-${dur}.wav`);
      await extractSampleWav(segPath, abs - WINDOW_START, dur, wav);
      let answer = "";
      try {
        const r = await recognizeWithShazam(wav);
        answer = r ? `${r.title} — ${r.artist}` : "(no match)";
      } catch (e) {
        answer = `ERROR: ${e instanceof Error ? e.message : e}`;
      }
      console.log(`${String(abs).padEnd(4)} | ${String(dur).padEnd(3)} | ${answer}`);
      await sleep(3000);
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
