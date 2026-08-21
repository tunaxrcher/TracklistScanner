import { spawn, ChildProcess } from "child_process";
import os from "os";
import { toolEnv } from "@/lib/server/bin";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  onSpawn?: (proc: ChildProcess) => void;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  cwd?: string;
}

/** Kill a process and its whole tree (yt-dlp spawns ffmpeg children). */
export function killTree(proc: ChildProcess): void {
  if (proc.pid == null || proc.killed) return;
  if (os.platform() === "win32") {
    try {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      proc.kill();
    }
  } else {
    try {
      proc.kill("SIGKILL");
    } catch {
      // already dead
    }
  }
}

/**
 * Spawn a binary with an argument array (never a shell string, so user input
 * cannot inject commands). Resolves with exit code + captured output.
 */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const proc = spawn(bin, args, { windowsHide: true, cwd: opts.cwd, env: toolEnv() });
    opts.onSpawn?.(proc);

    let stdout = "";
    let stderr = "";
    let stdoutBuf = "";
    let stderrBuf = "";

    const onAbort = () => killTree(proc);
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout?.on("data", (d: Buffer) => {
      const text = d.toString("utf8");
      stdout += text;
      if (opts.onStdoutLine) {
        stdoutBuf += text;
        // yt-dlp uses \r for progress updates; treat it as a line break too
        const lines = stdoutBuf.split(/\r\n|\n|\r/);
        stdoutBuf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) opts.onStdoutLine(line);
      }
    });
    proc.stderr?.on("data", (d: Buffer) => {
      const text = d.toString("utf8");
      stderr += text;
      if (opts.onStderrLine) {
        stderrBuf += text;
        const lines = stderrBuf.split(/\r\n|\n|\r/);
        stderrBuf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) opts.onStderrLine(line);
      }
    });

    proc.on("error", (err) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    proc.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
}
