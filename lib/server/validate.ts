import { AppError } from "@/lib/errors";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

/** True when `host` is any kind of IP literal (v4 dotted, v6 bracketed). */
function isIpLiteral(host: string): boolean {
  // WHATWG URL parsing already normalizes hex/octal/short IPv4 forms to dotted.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":");
}

/**
 * Validate a user-supplied URL before it is handed to yt-dlp.
 *
 * Only http(s) to a real hostname is allowed: no IP literals at all (that
 * removes every loopback / private / link-local / IPv4-mapped-IPv6 form in
 * one rule instead of a blocklist we'd have to keep complete), no localhost
 * aliases, no `.local`/single-label names. yt-dlp supports hundreds of
 * extractors plus generic HTTP, so without this an authenticated user could
 * point the server at internal services or metadata endpoints.
 *
 * The URL is always passed to yt-dlp as a single spawn() argument, never
 * through a shell.
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
  if (url.username || url.password) throw new AppError("INVALID_URL");

  const host = url.hostname.toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || isIpLiteral(host)) throw new AppError("INVALID_URL");
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new AppError("INVALID_URL");
  }

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
