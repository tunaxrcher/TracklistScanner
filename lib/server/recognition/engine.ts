import { recognizeWithShazam } from "./shazam";
import { recognizeWithAcrCloud, isAcrConfigured } from "./acrcloud";
import type { RecognitionResult } from "./types";
import type { ScanSettings } from "@/lib/types";
import { AppError } from "@/lib/errors";

export interface RecognizeOutcome {
  result: RecognitionResult | null;
  /**
   * True when no provider could give a reliable answer (rate limit / errors),
   * as opposed to a confident "no match". The scanner uses this to slow down
   * and to report incomplete coverage to the user.
   */
  degraded: boolean;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const SHAZAM_RETRIES = 2;
const RETRY_DELAYS_MS = [4_000, 10_000];

/**
 * Central recognition engine used by every scan source.
 *
 * Pipeline: Shazam (primary, with rate-limit retries) → ACRCloud (fallback).
 * ACRCloud is only called when Shazam finds nothing or fails, which keeps
 * paid API usage to a minimum.
 */
export async function recognizeSample(
  wavPath: string,
  settings: Pick<ScanSettings, "useShazam" | "useAcrCloud">,
  signal?: AbortSignal,
): Promise<RecognizeOutcome> {
  let shazamAnswered = false;
  let rateLimited = false;

  // With ACR available as a fallback, don't burn long waits on repeated
  // Shazam retries — a missed marginal song gets revisited by the scanner's
  // gap-fill pass anyway.
  const hasFallback = settings.useAcrCloud && isAcrConfigured();
  const maxRetries = hasFallback ? 1 : SHAZAM_RETRIES;

  if (settings.useShazam) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const result = await recognizeWithShazam(wavPath);
        shazamAnswered = true;
        rateLimited = false;
        if (result) return { result, degraded: false };
        break; // confident "no match" — don't burn retries
      } catch (err) {
        if (err instanceof AppError && err.code === "SHAZAM_RATE_LIMIT") {
          rateLimited = true;
          if (attempt < maxRetries) {
            console.warn(`[shazam] rate limited, retrying in ${RETRY_DELAYS_MS[attempt]}ms`);
            await sleep(RETRY_DELAYS_MS[attempt], signal);
            continue;
          }
          console.warn("[shazam] rate limited, giving up on this sample");
        } else {
          console.warn("[shazam]", err instanceof Error ? err.message : err);
        }
        break;
      }
    }
  }

  if (settings.useAcrCloud && isAcrConfigured()) {
    try {
      const result = await recognizeWithAcrCloud(wavPath);
      if (result) return { result, degraded: false };
      // ACR saying "no match" is only a full answer when Shazam also had its
      // say. If Shazam was rate-limited, the song may simply be missing from
      // ACR's catalog — treat it as degraded so the scanner backs off and the
      // gap-fill pass revisits this region.
      return { result: null, degraded: settings.useShazam && !shazamAnswered };
    } catch (err) {
      if (err instanceof AppError && err.code === "ACR_RATE_LIMIT") throw err;
      console.warn("[acrcloud]", err instanceof Error ? err.message : err);
      return { result: null, degraded: true };
    }
  }

  // No result: degraded unless Shazam genuinely answered "no match".
  return { result: null, degraded: !shazamAnswered || rateLimited };
}
