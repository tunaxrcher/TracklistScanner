import { AppError } from "@/lib/errors";

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * Validate a user-supplied URL before it is handed to yt-dlp.
 * Only http(s) with a public-looking hostname is allowed. The URL is always
 * passed to yt-dlp as a single spawn() argument, never through a shell.
 */
export function validateMediaUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) throw new AppError("INVALID_URL");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError("INVALID_URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AppError("INVALID_URL");

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) throw new AppError("INVALID_URL");
  // Block private IPv4 ranges
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)) {
    throw new AppError("INVALID_URL");
  }
  if (!host.includes(".")) throw new AppError("INVALID_URL");

  return url.toString();
}

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".webm", ".mp4", ".mka", ".wma",
]);

export function isSupportedAudioFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return AUDIO_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

/** Strip path separators / traversal from an uploaded file name. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").slice(0, 200) || "file";
}
