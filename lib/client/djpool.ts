import type { DjPoolCandidate, DjPoolTrackStatus } from "@/lib/types";

export type DjRowStatus =
  | "idle"
  | "checking"
  | "available"
  | "searching"
  | "downloading"
  | "done"
  | "notfound"
  | "failed";

export interface DjRowState {
  status: DjRowStatus;
  fileName?: string;
  error?: string;
  /** Download progress 0-100 (undefined = size unknown / indeterminate). */
  progress?: number;
  /** Last version that landed on disk (`source:url`). Used so a new pin can offer Get again. */
  savedKey?: string;
}

/** Stable id for a chosen / saved version. */
export function versionKey(source: "djpool" | "youtube", url?: string): string {
  return `${source}:${url || "auto"}`;
}

/** Player src for previewing a DJ Pool candidate (shared by panel and picker). */
export function djPoolStreamSrc(candidate: DjPoolCandidate): string {
  return `/api/djpool/stream?u=${encodeURIComponent(candidate.stream || candidate.download)}`;
}

/** Player src for previewing a YouTube video's audio. */
export function youtubeStreamSrc(videoUrl: string): string {
  return `/api/youtube/stream?u=${encodeURIComponent(videoUrl)}`;
}

/** Map a server-side job track status onto the table's row status. */
export function rowStatusFromJob(status: DjPoolTrackStatus): DjRowStatus {
  switch (status) {
    case "pending":
    case "searching":
    case "matched":
      return "searching";
    case "downloading":
      return "downloading";
    case "downloaded":
      return "done";
    case "notfound":
      return "notfound";
    case "skipped":
      return "idle";
    default:
      return "failed";
  }
}

/**
 * Read a response body into a Blob while reporting percent progress.
 * Falls back to a plain blob() (no progress) when the size is unknown.
 */
export async function readBlobWithProgress(
  res: Response,
  onProgress: (percent: number) => void,
): Promise<Blob> {
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || !Number.isFinite(total) || total <= 0) return res.blob();

  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  let lastPercent = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const percent = Math.min(100, Math.round((received / total) * 100));
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress(percent);
    }
  }
  return new Blob(chunks, { type: res.headers.get("content-type") ?? undefined });
}

/** Trigger a browser "Save as" for an in-memory blob. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Parse a filename out of a Content-Disposition response header. */
export function filenameFromResponse(res: Response, fallback: string): string {
  const disposition = res.headers.get("content-disposition") ?? "";
  const star = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      /* fall through */
    }
  }
  return disposition.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

export type { DjPoolCandidate };
