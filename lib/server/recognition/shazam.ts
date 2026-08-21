import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { recognizeBytes } from "shazamio-core";
import { Shazam } from "node-shazam";
import { AppError } from "@/lib/errors";
import type { RecognitionResult } from "./types";

const SHAZAM_TIMEOUT_MS = 20_000;

// Reuse node-shazam only for its request headers (real app fingerprint).
let headerSource: Shazam | null = null;
function shazamHeaders(): Record<string, string> {
  headerSource ??= new Shazam();
  return headerSource.headers("en-US") as unknown as Record<string, string>;
}

function endpointUrl(): string {
  const url = new URL(
    `https://amp.shazam.com/discovery/v5/en/US/iphone/-/tag/${randomUUID()}/${randomUUID()}`,
  );
  const params: Record<string, string> = {
    sync: "true",
    webv3: "true",
    sampling: "true",
    connected: "",
    shazamapiversion: "v3",
    sharehub: "true",
    hubv5minorversion: "v5.1",
    hidelb: "true",
    video: "v3",
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  return url.toString();
}

interface ShazamResponse {
  matches?: { id: string }[];
  track?: {
    title?: string;
    subtitle?: string;
    images?: { coverart?: string; coverarthq?: string };
    sections?: { type: string; metadata?: { title: string; text: string }[] }[];
  };
}

/**
 * Recognize a mono 16 kHz WAV sample with Shazam.
 *
 * Unlike node-shazam's recognise() — which fires several requests per file —
 * this sends exactly ONE request per sample (using the middle signature), so
 * scans generate far less traffic and are much less likely to be blocked.
 *
 * Returns null on "no match".
 * Throws AppError("SHAZAM_RATE_LIMIT") when Shazam blocks the request
 * (HTTP 429/403 or an HTML body instead of JSON).
 */
export async function recognizeWithShazam(wavPath: string): Promise<RecognitionResult | null> {
  const signatures = recognizeBytes(readFileSync(wavPath), 0, Number.MAX_SAFE_INTEGER);
  try {
    const sig = signatures[Math.floor(signatures.length / 2)];
    if (!sig) return null;

    const body = JSON.stringify({
      timezone: "Europe/Paris",
      signature: { uri: sig.uri, samplems: sig.samplems },
      timestamp: Date.now(),
      context: {},
      geolocation: {},
    });

    let response: Response;
    try {
      response = await fetch(endpointUrl(), {
        method: "POST",
        headers: shazamHeaders(),
        body,
        signal: AbortSignal.timeout(SHAZAM_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new AppError("SHAZAM_TIMEOUT");
      }
      throw err;
    }

    if (response.status === 429 || response.status === 403) {
      throw new AppError("SHAZAM_RATE_LIMIT");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("json")) {
      // Blocked requests come back as an HTML error page.
      throw new AppError("SHAZAM_RATE_LIMIT");
    }

    const data = (await response.json()) as ShazamResponse;
    const track = data.track;
    if (!data.matches?.length || !track?.title) return null;

    const songSection = track.sections?.find((s) => s.type === "SONG");
    const album = songSection?.metadata?.find((m) => m.title === "Album")?.text;

    return {
      title: track.title,
      artist: track.subtitle ?? "Unknown Artist",
      album,
      coverUrl: track.images?.coverart ?? track.images?.coverarthq,
      provider: "shazam",
    };
  } finally {
    for (const sig of signatures) sig.free();
  }
}
