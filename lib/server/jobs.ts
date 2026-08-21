import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { ChildProcess } from "child_process";
import type { Job, JobStatus, JobType } from "@/lib/types";
import { killTree } from "@/lib/server/proc";
import { cleanupJobTemp, jobTempDir } from "@/lib/server/paths";

export interface JobRecord {
  job: Job;
  emitter: EventEmitter;
  abort: AbortController;
  procs: Set<ChildProcess>;
  keepTemp: boolean;
  /** Absolute path of the final output file for download jobs */
  outputFile?: string;
}

class JobManager {
  private records = new Map<string, JobRecord>();

  create(type: JobType, keepTemp = false): JobRecord {
    const id = randomUUID();
    const record: JobRecord = {
      job: { id, type, status: "queued", createdAt: Date.now() },
      emitter: new EventEmitter(),
      abort: new AbortController(),
      procs: new Set(),
      keepTemp,
    };
    record.emitter.setMaxListeners(50);
    this.records.set(id, record);
    jobTempDir(id);
    this.gc();
    return record;
  }

  get(id: string): JobRecord | undefined {
    return this.records.get(id);
  }

  /** Mutate the job and notify SSE subscribers. */
  update(id: string, mutate: (job: Job) => void): void {
    const record = this.records.get(id);
    if (!record) return;
    mutate(record.job);
    record.emitter.emit("update", record.job);
  }

  setStatus(id: string, status: JobStatus, error?: string): void {
    this.update(id, (job) => {
      job.status = status;
      if (error !== undefined) job.error = error;
    });
    if (status === "completed" || status === "failed" || status === "cancelled") {
      this.finalize(id);
    }
  }

  registerProc(id: string, proc: ChildProcess): void {
    const record = this.records.get(id);
    if (!record) return;
    record.procs.add(proc);
    proc.on("close", () => record.procs.delete(proc));
  }

  isCancelled(id: string): boolean {
    return this.records.get(id)?.abort.signal.aborted ?? true;
  }

  cancel(id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    const { status } = record.job;
    if (status === "completed" || status === "failed" || status === "cancelled") return false;
    record.abort.abort();
    for (const proc of record.procs) killTree(proc);
    this.setStatus(id, "cancelled");
    return true;
  }

  private finalize(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    if (!record.keepTemp) {
      // Small delay so killed child processes release file handles on Windows.
      setTimeout(() => cleanupJobTemp(id), 1500);
    }
  }

  /** Drop finished jobs older than 2 hours to keep memory bounded. */
  private gc(): void {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, record] of this.records) {
      const done =
        record.job.status === "completed" ||
        record.job.status === "failed" ||
        record.job.status === "cancelled";
      if (done && record.job.createdAt < cutoff) this.records.delete(id);
    }
  }
}

// Survive Next.js dev-server module reloads.
const globalStore = globalThis as unknown as { __jobManager?: JobManager };
export const jobManager: JobManager = (globalStore.__jobManager ??= new JobManager());
