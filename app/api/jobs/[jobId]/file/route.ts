import { NextRequest } from "next/server";
import { createReadStream, statSync } from "fs";
import path from "path";
import { Readable } from "stream";
import { isJobRecord, requireJob } from "@/lib/server/jobAccess";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".webm": "audio/webm",
  ".mka": "audio/x-matroska",
  ".zip": "application/zip",
};

/** Serve the finished download file. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const loaded = await requireJob(request, jobId);
  if (!isJobRecord(loaded)) return loaded;
  const record = loaded;
  if (!record.outputFile || record.job.status !== "completed") {
    return new Response("File not ready.", { status: 404 });
  }

  const filePath = record.outputFile;
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return new Response("File no longer exists.", { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
