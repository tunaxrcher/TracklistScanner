import { spawnSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";
import os from "os";
import { AppError, type AppErrorCode } from "@/lib/errors";

// Successful lookups are cached; failures are NOT, so a binary installed
// while the server is running is picked up on the next call.
const resolved = new Map<string, string>();

function works(bin: string): boolean {
  for (const flag of ["-version", "--version"]) {
    try {
      const r = spawnSync(bin, [flag], { timeout: 10_000, windowsHide: true });
      if (!r.error && r.status === 0) return true;
    } catch {
      // try next flag
    }
  }
  return false;
}

/** Resolve a bare command name to an absolute path (needed for --ffmpeg-location). */
function toAbsolute(bin: string): string {
  if (path.isAbsolute(bin)) return bin;
  const finder = os.platform() === "win32" ? "where.exe" : "which";
  try {
    const r = spawnSync(finder, [bin], { timeout: 10_000, windowsHide: true, encoding: "utf8" });
    if (r.status === 0) {
      const first = r.stdout.split(/\r?\n/).find((l) => l.trim());
      if (first) return first.trim();
    }
  } catch {
    // keep the bare name
  }
  return bin;
}

/** Shallow recursive search for an exe under a directory (winget package layouts). */
function findExeUnder(dir: string, exeName: string, depth: number): string | null {
  const direct = path.join(dir, exeName);
  if (existsSync(direct)) return direct;
  if (depth <= 0) return null;
  try {
    for (const entry of readdirSync(dir)) {
      const child = path.join(dir, entry);
      try {
        if (statSync(child).isDirectory()) {
          const found = findExeUnder(child, exeName, depth - 1);
          if (found) return found;
        }
      } catch {
        // skip unreadable entries
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Find a binary inside the winget packages folder (Windows portable installs).
 * Handles nested layouts like Gyan.FFmpeg_...\ffmpeg-x.y-full_build\bin\ffmpeg.exe
 */
function findWingetBinary(packagePrefix: string, exeName: string): string | null {
  if (os.platform() !== "win32") return null;
  const base = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  try {
    for (const dir of readdirSync(base)) {
      if (dir.toLowerCase().startsWith(packagePrefix)) {
        const found = findExeUnder(path.join(base, dir), exeName, 2);
        if (found) return found;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * yt-dlp needs deno on PATH to solve YouTube JS challenges. If the server was
 * launched from a shell with a stale PATH (e.g. right after a winget install),
 * append known tool directories so spawned yt-dlp still finds it.
 */
let cachedToolEnv: NodeJS.ProcessEnv | undefined;
export function toolEnv(): NodeJS.ProcessEnv {
  if (cachedToolEnv) return cachedToolEnv;
  const extra: string[] = [];
  const deno = findWingetBinary("denoland.deno", "deno.exe");
  if (deno) extra.push(path.dirname(deno));
  const ytdlp = findWingetBinary("yt-dlp.yt-dlp", "yt-dlp.exe");
  if (ytdlp) extra.push(path.dirname(ytdlp));
  if (extra.length === 0) return process.env;
  const sep = os.platform() === "win32" ? ";" : ":";
  cachedToolEnv = { ...process.env, PATH: [process.env.PATH ?? "", ...extra].join(sep) };
  return cachedToolEnv;
}

interface BinarySpec {
  /** Cache key */
  name: string;
  envVar: string;
  command: string;
  /** winget package prefixes to search as a last resort (Windows) */
  wingetPackages: string[];
  exeName: string;
  errorCode: AppErrorCode;
}

const SPECS: Record<"ytdlp" | "ffmpeg" | "ffprobe", BinarySpec> = {
  ytdlp: {
    name: "ytdlp",
    envVar: "YTDLP_PATH",
    command: "yt-dlp",
    wingetPackages: ["yt-dlp.yt-dlp"],
    exeName: "yt-dlp.exe",
    errorCode: "YTDLP_MISSING",
  },
  ffmpeg: {
    name: "ffmpeg",
    envVar: "FFMPEG_PATH",
    command: "ffmpeg",
    wingetPackages: ["gyan.ffmpeg", "yt-dlp.ffmpeg"],
    exeName: "ffmpeg.exe",
    errorCode: "FFMPEG_MISSING",
  },
  ffprobe: {
    name: "ffprobe",
    envVar: "FFPROBE_PATH",
    command: "ffprobe",
    wingetPackages: ["gyan.ffmpeg", "yt-dlp.ffmpeg"],
    exeName: "ffprobe.exe",
    errorCode: "FFMPEG_MISSING",
  },
};

function resolveBinary(spec: BinarySpec): string {
  const cached = resolved.get(spec.name);
  if (cached) return cached;

  const candidates: string[] = [];
  const fromEnv = process.env[spec.envVar];
  if (fromEnv) candidates.push(fromEnv);
  candidates.push(spec.command);
  for (const pkg of spec.wingetPackages) {
    const found = findWingetBinary(pkg, spec.exeName);
    if (found) candidates.push(found);
  }

  for (const candidate of candidates) {
    if (works(candidate)) {
      const abs = toAbsolute(candidate);
      resolved.set(spec.name, abs);
      return abs;
    }
  }
  throw new AppError(spec.errorCode);
}

export function resolveYtDlp(): string {
  return resolveBinary(SPECS.ytdlp);
}

export function resolveFfmpeg(): string {
  return resolveBinary(SPECS.ffmpeg);
}

export function resolveFfprobe(): string {
  return resolveBinary(SPECS.ffprobe);
}
