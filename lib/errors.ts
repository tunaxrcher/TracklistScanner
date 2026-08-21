/**
 * AppError carries a user-friendly message that is safe to show in the UI.
 * Raw stderr / stack traces stay on the server (logged to console only).
 */
export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message?: string,
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = "AppError";
  }
}

export type AppErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_URL"
  | "PRIVATE_VIDEO"
  | "LOGIN_REQUIRED"
  | "VIDEO_UNAVAILABLE"
  | "YTDLP_MISSING"
  | "FFMPEG_MISSING"
  | "FFMPEG_ERROR"
  | "UNSUPPORTED_FORMAT"
  | "CORRUPTED_AUDIO"
  | "SHAZAM_TIMEOUT"
  | "SHAZAM_RATE_LIMIT"
  | "ACR_TIMEOUT"
  | "ACR_RATE_LIMIT"
  | "ACR_NOT_CONFIGURED"
  | "NO_SONG_DETECTED"
  | "DJPOOL_NOT_CONFIGURED"
  | "DJPOOL_LOGIN_FAILED"
  | "DJPOOL_UNAVAILABLE"
  | "DISK_FULL"
  | "PERMISSION_DENIED"
  | "CANCELLED"
  | "UNKNOWN";

export const ERROR_MESSAGES: Record<AppErrorCode, string> = {
  INVALID_URL: "The URL is not valid. Please paste a full http(s) link.",
  UNSUPPORTED_URL: "This URL is not supported by the downloader.",
  PRIVATE_VIDEO: "This video is private and cannot be accessed.",
  LOGIN_REQUIRED: "This content requires a login and cannot be accessed.",
  VIDEO_UNAVAILABLE: "This video is unavailable or has been removed.",
  YTDLP_MISSING: "yt-dlp was not found on this machine. Install it and restart the app.",
  FFMPEG_MISSING: "FFmpeg was not found on this machine. Install it and restart the app.",
  FFMPEG_ERROR: "Audio processing failed (FFmpeg error).",
  UNSUPPORTED_FORMAT: "This file format is not supported.",
  CORRUPTED_AUDIO: "The audio file appears to be corrupted or unreadable.",
  SHAZAM_TIMEOUT: "Shazam did not respond in time.",
  SHAZAM_RATE_LIMIT: "Shazam is rate-limiting requests. Scanning will slow down and retry.",
  ACR_TIMEOUT: "ACRCloud did not respond in time.",
  ACR_RATE_LIMIT: "ACRCloud rate limit reached. Try again later.",
  ACR_NOT_CONFIGURED: "ACRCloud credentials are not configured.",
  NO_SONG_DETECTED: "No songs were detected in this audio.",
  DJPOOL_NOT_CONFIGURED: "DJ Pool account is not configured. Add DJPOOL_EMAIL and DJPOOL_PASSWORD to .env.local.",
  DJPOOL_LOGIN_FAILED: "Could not sign in to DJ Pool Records. Check the account email and password.",
  DJPOOL_UNAVAILABLE: "DJ Pool Records could not be reached. Try again later.",
  DISK_FULL: "Not enough disk space to complete this job.",
  PERMISSION_DENIED: "Permission denied while accessing files.",
  CANCELLED: "The job was cancelled.",
  UNKNOWN: "Something went wrong. Please try again.",
};

/** Map raw yt-dlp stderr output to a friendly error. */
export function classifyYtDlpError(stderr: string): AppError {
  const s = stderr.toLowerCase();
  if (s.includes("private video")) return new AppError("PRIVATE_VIDEO");
  if (s.includes("sign in") || s.includes("login required") || s.includes("account"))
    return new AppError("LOGIN_REQUIRED");
  if (s.includes("video unavailable") || s.includes("removed") || s.includes("not available"))
    return new AppError("VIDEO_UNAVAILABLE");
  if (s.includes("unsupported url")) return new AppError("UNSUPPORTED_URL");
  if (s.includes("is not a valid url")) return new AppError("INVALID_URL");
  if (s.includes("no space left") || s.includes("disk full")) return new AppError("DISK_FULL");
  if (s.includes("permission denied")) return new AppError("PERMISSION_DENIED");
  return new AppError("UNKNOWN", "The media could not be processed. Check the URL and try again.");
}

export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error && err.name === "AbortError") return ERROR_MESSAGES.CANCELLED;
  return ERROR_MESSAGES.UNKNOWN;
}
