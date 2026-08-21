import type { DjPoolCandidate, DjPoolTrackStatus } from "@/lib/types";

export type DjRowStatus = "idle" | "searching" | "downloading" | "done" | "notfound" | "failed";

export interface DjRowState {
  status: DjRowStatus;
  fileName?: string;
  error?: string;
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
