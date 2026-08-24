import { jobManager } from "@/lib/server/jobs";
import { jobDownloadDir, jobTempDir } from "@/lib/server/paths";
import { fetchMediaInfo } from "@/lib/server/ytdlp";
import { youtubeToFile } from "@/lib/server/djdl/convert";
import { toUserMessage } from "@/lib/errors";
import type { DjDownloadFormat } from "@/lib/types";

export interface DjDlRequest {
  url: string;
  format: DjDownloadFormat;
}

export function startDjDlJob(jobId: string, request: DjDlRequest): void {
  void runDjDl(jobId, request).catch((err) => {
    const record = jobManager.get(jobId);
    if (!record) return;
    if (record.abort.signal.aborted || record.job.status === "cancelled") return;
    console.error(`[djdl ${jobId}]`, err);
    jobManager.setStatus(jobId, "failed", toUserMessage(err));
  });
}

async function runDjDl(jobId: string, request: DjDlRequest): Promise<void> {
  const record = jobManager.get(jobId);
  if (!record) return;
  const signal = record.abort.signal;
  const ctx = {
    signal,
    onSpawn: (proc: Parameters<typeof jobManager.registerProc>[1]) => jobManager.registerProc(jobId, proc),
  };

  jobManager.update(jobId, (job) => {
    job.djdl = { url: request.url, format: request.format, downloadProgress: 0 };
  });

  jobManager.setStatus(jobId, "preparing");
  const info = await fetchMediaInfo(request.url, ctx);
  jobManager.update(jobId, (job) => {
    if (job.djdl) job.djdl.info = info;
  });

  jobManager.setStatus(jobId, "downloading");
  let lastPercent = -1;
  const result = await youtubeToFile({
    ...ctx,
    url: request.url,
    format: request.format,
    workDir: jobTempDir(jobId),
    outDir: jobDownloadDir(jobId),
    info,
    onDownloadProgress: (e) => {
      const percent = Math.round(e.percent ?? 0);
      if (percent === lastPercent) return;
      lastPercent = percent;
      jobManager.update(jobId, (job) => {
        if (job.djdl) job.djdl.downloadProgress = percent;
      });
      // Conversion starts when the fetch hits 100%.
      if (percent >= 100) jobManager.setStatus(jobId, "processing");
    },
  });

  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  record.outputFile = result.filePath;
  jobManager.update(jobId, (job) => {
    if (job.djdl) {
      job.djdl.fileName = result.fileName;
      job.djdl.fileSize = result.fileSize;
      job.djdl.downloadProgress = 100;
    }
  });
  jobManager.setStatus(jobId, "completed");
}
