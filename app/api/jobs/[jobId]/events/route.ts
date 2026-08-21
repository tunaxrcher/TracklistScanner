import { NextRequest } from "next/server";
import { jobManager } from "@/lib/server/jobs";
import type { Job } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/** Server-Sent Events stream of job state. Closes when the job finishes. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const record = jobManager.get(jobId);
  if (!record) return new Response("Job not found.", { status: 404 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      // Throttle bursts of updates to ~10/s to keep the stream light.
      let pending: Job | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const send = (job: Job) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(job)}\n\n`));
        } catch {
          cleanup();
        }
        if (TERMINAL.has(job.status)) {
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };

      const onUpdate = (job: Job) => {
        if (timer) {
          pending = job;
          return;
        }
        send(job);
        timer = setTimeout(() => {
          timer = null;
          if (pending) {
            const p = pending;
            pending = null;
            send(p);
          }
        }, 100);
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (timer) clearTimeout(timer);
        record.emitter.off("update", onUpdate);
      };

      record.emitter.on("update", onUpdate);
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      // Initial snapshot
      send(record.job);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
