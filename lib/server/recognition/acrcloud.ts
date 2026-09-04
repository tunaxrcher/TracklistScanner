import { createHmac } from "crypto";
import { readFile } from "fs/promises";
import { AppError } from "@/lib/errors";
import { withTimeout, type RecognitionResult } from "./types";

const ACR_TIMEOUT_MS = 15_000;

export function isAcrConfigured(): boolean {
  return Boolean(
    process.env.ACR_HOST && process.env.ACR_ACCESS_KEY && process.env.ACR_ACCESS_SECRET,
  );
}

interface AcrResponse {
  status: { code: number; msg: string };
  metadata?: {
    music?: {
      title?: string;
      album?: { name?: string };
      artists?: { name?: string }[];
      external_metadata?: {
        spotify?: { album?: { images?: { url?: string }[] } };
        deezer?: { album?: { cover?: string } };
      };
    }[];
  };
}

/**
 * ACRCloud identify API (fallback provider).
 * Docs: https://docs.acrcloud.com/reference/identification-api
 */
export async function recognizeWithAcrCloud(
  wavPath: string,
  signal?: AbortSignal,
): Promise<RecognitionResult | null> {
  if (!isAcrConfigured()) throw new AppError("ACR_NOT_CONFIGURED");

  const host = process.env.ACR_HOST!;
  const accessKey = process.env.ACR_ACCESS_KEY!;
  const accessSecret = process.env.ACR_ACCESS_SECRET!;

  const sample = await readFile(wavPath);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = ["POST", "/v1/identify", accessKey, "audio", "1", timestamp].join("\n");
  const signature = createHmac("sha1", accessSecret).update(stringToSign).digest("base64");

  const form = new FormData();
  form.append("sample", new Blob([new Uint8Array(sample)]), "sample.wav");
  form.append("sample_bytes", String(sample.length));
  form.append("access_key", accessKey);
  form.append("data_type", "audio");
  form.append("signature_version", "1");
  form.append("signature", signature);
  form.append("timestamp", timestamp);

  let response: Response;
  try {
    response = await fetch(`https://${host}/v1/identify`, {
      method: "POST",
      body: form,
      signal: withTimeout(signal, ACR_TIMEOUT_MS),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new AppError("ACR_TIMEOUT");
    }
    throw err;
  }

  const data = (await response.json().catch(() => null)) as AcrResponse | null;
  const code = data?.status?.code;
  if (!data || typeof code !== "number") {
    console.warn("[acrcloud] unexpected response shape", response.status);
    return null;
  }

  // status.code: 0 = found, 1001 = no result, 3003/3015 = quota/rate limits
  if (code === 1001) return null;
  if (code === 3003 || code === 3015) throw new AppError("ACR_RATE_LIMIT");
  if (code !== 0) {
    console.warn("[acrcloud]", code, data.status.msg);
    return null;
  }

  const music = data.metadata?.music?.[0];
  if (!music?.title) return null;

  const coverUrl =
    music.external_metadata?.spotify?.album?.images?.[0]?.url ??
    music.external_metadata?.deezer?.album?.cover;

  return {
    title: music.title,
    artist: music.artists?.map((a) => a.name).filter(Boolean).join(", ") || "Unknown Artist",
    album: music.album?.name,
    coverUrl,
    provider: "acrcloud",
  };
}
