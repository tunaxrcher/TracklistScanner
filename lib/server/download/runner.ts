import path from "path";
import { statSync } from "fs";
import type { ChildProcess } from "child_process";
import { jobManager } from "@/lib/server/jobs";
import { jobDownloadDir } from "@/lib/server/paths";
import { downloadAudio, fetchMediaInfo } from "@/lib/server/ytdlp";
import { toUserMessage } from "@/lib/errors";
import type { DownloadFormat, DownloadSettings } from "@/lib/types";

export interface DownloadRequest {
  url: string;
  format: DownloadFormat;
  settings: DownloadSettings;
}

export function startDownloadJob(jobId: string, request: DownloadRequest): void {
  void runDownload(jobId, request).catch((err) => {
    const record = jobManager.get(jobId);
    if (!record) return;
    if (record.abort.signal.aborted || record.job.status === "cancelled") return;
    console.error(`[download ${jobId}]`, err);
    jobManager.setStatus(jobId, "failed", toUserMessage(err));
  });
}

async function runDownload(jobId: string, request: DownloadRequest): Promise<void> {
  const record = jobManager.get(jobId);
  if (!record) return;
  const signal = record.abort.signal;
  const ctx = {
    signal,
    onSpawn: (proc: ChildProcess) => jobManager.registerProc(jobId, proc),
  };

  jobManager.update(jobId, (job) => {
    job.download = { url: request.url, format: request.format, percent: 0 };
  });

  jobManager.setStatus(jobId, "preparing");
  const info = await fetchMediaInfo(request.url, ctx);
  jobManager.update(jobId, (job) => {
    if (job.download) job.download.info = info;
  });

  jobManager.setStatus(jobId, "downloading");
  const outDir = jobDownloadDir(jobId);
  const filePath = await downloadAudio(
    request.url,
    request.format,
    outDir,
    request.settings.mp3Quality,
    (e) => {
      jobManager.update(jobId, (job) => {
        if (!job.download) return;
        if (e.percent != null) job.download.percent = e.percent;
        if (e.speed !== undefined) job.download.speed = e.speed;
        if (e.eta !== undefined) job.download.eta = e.eta;
        if (e.statusText) {
          job.download.statusText = e.statusText;
          job.status = "processing";
        }
      });
    },
    ctx,
  );

  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  record.outputFile = filePath;
  const size = statSync(filePath).size;
  jobManager.update(jobId, (job) => {
    if (!job.download) return;
    job.download.percent = 100;
    job.download.fileName = path.basename(filePath);
    job.download.fileSize = size;
    job.download.statusText = undefined;
    job.download.speed = undefined;
    job.download.eta = undefined;
  });
  jobManager.setStatus(jobId, "completed");
}
