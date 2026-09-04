import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { ChildProcess } from "child_process";
import type { Job, JobStatus, JobType } from "@/lib/types";
import { killTree } from "@/lib/server/proc";
import { cleanupJobDownloads, cleanupJobTemp, jobTempDir, sweepOrphanedJobDirs } from "@/lib/server/paths";

/** Statuses where no work is running. `paused` can still be resumed. */
const TERMINAL = new Set<JobStatus>(["completed", "failed", "cancelled", "paused"]);
/** Statuses where the job is over for good and its temp dir can go. */
const FINISHED = new Set<JobStatus>(["completed", "failed", "cancelled"]);

export interface JobCreateOptions {
  keepTemp?: boolean;
  owner?: string | null;
}

export interface JobRecord {
  job: Job;
  emitter: EventEmitter;
  abort: AbortController;
  procs: Set<ChildProcess>;
  keepTemp: boolean;
  ownerEmail?: string;
  /** Absolute path of the final output file for download jobs */
  outputFile?: string;
  /** User closed this finished job (New Scan) — don't offer it for reconnect. */
  dismissed?: boolean;
  /** Pending temp cleanup, so a resume can call it off. */
  cleanupTimer?: ReturnType<typeof setTimeout>;
  /**
   * The currently running worker for this job. Runners that support resume
   * chain onto it so two workers never write into the same directory.
   */
  runner?: Promise<void>;
}

class JobManager {
  private records = new Map<string, JobRecord>();

  create(type: JobType, options: JobCreateOptions = {}): JobRecord {
    const id = randomUUID();
    const ownerEmail = options.owner ?? undefined;
    const record: JobRecord = {
      job: { id, type, status: "queued", createdAt: Date.now(), ownerEmail },
      emitter: new EventEmitter(),
      abort: new AbortController(),
      procs: new Set(),
      keepTemp: Boolean(options.keepTemp),
      ownerEmail,
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

  /** Ids of every job still held in memory (for the orphan-folder sweep). */
  knownIds(): ReadonlySet<string> {
    return new Set(this.records.keys());
  }

  /** Latest job of this type for the account, including finished ones still in memory. */
  findLatestByOwner(email: string, type: JobType): JobRecord | undefined {
    let latest: JobRecord | undefined;
    for (const record of this.records.values()) {
      if (record.ownerEmail !== email || record.job.type !== type || record.dismissed) continue;
      if (!latest || record.job.createdAt > latest.job.createdAt) latest = record;
    }
    return latest;
  }

  /** Hide a finished job from reconnect (`findLatestByOwner`). Running jobs are left alone. */
  dismiss(id: string): boolean {
    const record = this.records.get(id);
    if (!record || !FINISHED.has(record.job.status)) return false;
    record.dismissed = true;
    return true;
  }

  /** Latest paused Download All that can be continued. */
  findPausedByOwner(email: string, type: JobType): JobRecord | undefined {
    let latest: JobRecord | undefined;
    for (const record of this.records.values()) {
      if (record.ownerEmail !== email || record.job.type !== type) continue;
      if (record.job.status !== "paused") continue;
      if (!latest || record.job.createdAt > latest.job.createdAt) latest = record;
    }
    return latest;
  }

  /** Latest job of this type that is still running. */
  findActiveByOwner(email: string, type: JobType): JobRecord | undefined {
    let latest: JobRecord | undefined;
    for (const record of this.records.values()) {
      if (record.ownerEmail !== email || record.job.type !== type) continue;
      if (TERMINAL.has(record.job.status)) continue;
      if (!latest || record.job.createdAt > latest.job.createdAt) latest = record;
    }
    return latest;
  }

  canAccess(record: JobRecord, email: string | null): boolean {
    if (!record.ownerEmail) return true;
    return email === record.ownerEmail;
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
    if (FINISHED.has(status)) this.finalize(id);
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
    if (TERMINAL.has(status) && status !== "paused") return false;
    record.abort.abort();
    for (const proc of record.procs) killTree(proc);
    this.setStatus(id, "cancelled");
    return true;
  }

  /** Stop work but keep downloaded files so the same job can continue. */
  pause(id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    if (TERMINAL.has(record.job.status)) return false;
    record.abort.abort();
    for (const proc of record.procs) killTree(proc);
    this.setStatus(id, "paused");
    return true;
  }

  /** New abort controller after Pause, so Continue can run again. */
  resetAbort(id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    record.abort = new AbortController();
    if (record.cleanupTimer) {
      clearTimeout(record.cleanupTimer);
      record.cleanupTimer = undefined;
    }
    return true;
  }

  private finalize(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    if (!record.keepTemp && !record.cleanupTimer) {
      // Small delay so killed child processes release file handles on Windows.
      // A failed download job has nothing worth keeping; cancelled ones keep
      // their folder because a later Download All can resume from it.
      record.cleanupTimer = setTimeout(() => {
        cleanupJobTemp(id);
        if (record.job.status === "failed") cleanupJobDownloads(id);
      }, 1500);
    }
  }

  /**
   * Drop finished jobs older than the retention window to keep memory bounded,
   * and their download folders with them — without the record nothing can
   * serve or resume from those files anyway.
   */
  gc(): void {
    const cutoff = Date.now() - JOB_RETENTION_MS;
    for (const [id, record] of this.records) {
      if (TERMINAL.has(record.job.status) && record.job.createdAt < cutoff) {
        this.records.delete(id);
        cleanupJobTemp(id);
        cleanupJobDownloads(id);
      }
    }
  }
}

/** How long finished jobs (and their files) stay available. */
const JOB_RETENTION_MS = 2 * 60 * 60 * 1000;

// Survive Next.js dev-server module reloads. Bump the version whenever
// JobManager gains methods — otherwise HMR keeps a stale instance and
// new calls throw (Download All then shows "Something went wrong").
const JOB_MANAGER_VERSION = 6;
const globalStore = globalThis as unknown as {
  __jobManager?: JobManager;
  __jobManagerVersion?: number;
  __jobGcTimer?: ReturnType<typeof setInterval>;
};
if (globalStore.__jobManagerVersion !== JOB_MANAGER_VERSION) {
  globalStore.__jobManager = new JobManager();
  globalStore.__jobManagerVersion = JOB_MANAGER_VERSION;
  // Folders from a previous process can't be served anymore; retention is
  // measured from the folder's last write so an in-flight job isn't touched.
  sweepOrphanedJobDirs(JOB_RETENTION_MS);
  // Expire finished jobs on a schedule, not only when a new job is created.
  if (globalStore.__jobGcTimer) clearInterval(globalStore.__jobGcTimer);
  globalStore.__jobGcTimer = setInterval(() => {
    const manager = globalStore.__jobManager;
    if (!manager) return;
    manager.gc();
    sweepOrphanedJobDirs(JOB_RETENTION_MS, manager.knownIds());
  }, 10 * 60 * 1000);
  globalStore.__jobGcTimer.unref();
}
export const jobManager: JobManager = globalStore.__jobManager!;
