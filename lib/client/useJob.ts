"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/types";

/**
 * Track a backend job: subscribes to its SSE stream and exposes live state.
 */
export function useJob() {
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const disconnect = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => disconnect, [disconnect]);

  // The server no longer knows this job (e.g. dev-server restart): mark it
  // stopped locally so the UI unblocks and partial results stay usable.
  const markLost = useCallback(() => {
    disconnect();
    setJob((prev) =>
      prev && !["completed", "failed", "cancelled", "paused"].includes(prev.status)
        ? { ...prev, status: "cancelled" }
        : prev,
    );
  }, [disconnect]);

  const subscribe = useCallback(
    (jobId: string) => {
      disconnect();
      const source = new EventSource(`/api/jobs/${jobId}/events`);
      sourceRef.current = source;
      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as Job;
          setJob(data);
          if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
            disconnect();
          }
        } catch {
          // ignore malformed frames
        }
      };
      source.onerror = () => {
        // If the stream drops, fall back to one status fetch. A 404 means the
        // job is gone for good; transient network errors are left to the
        // EventSource auto-reconnect.
        fetch(`/api/jobs/${jobId}`)
          .then((r) => {
            if (r.status === 404) {
              markLost();
              return null;
            }
            return r.ok ? (r.json() as Promise<Job>) : null;
          })
          .then((data) => data && setJob(data))
          .catch(() => {});
      };
    },
    [disconnect, markLost],
  );

  /** Start a job via a request that returns { jobId } and begin streaming. */
  const start = useCallback(
    async (request: () => Promise<Response>) => {
      setError(null);
      setStarting(true);
      setJob(null);
      try {
        const response = await request();
        const data = (await response.json()) as { jobId?: string; error?: string };
        if (!response.ok || !data.jobId) {
          setError(data.error ?? "Failed to start the job.");
          return null;
        }
        subscribe(data.jobId);
        return data.jobId;
      } catch {
        setError("Could not reach the server.");
        return null;
      } finally {
        setStarting(false);
      }
    },
    [subscribe],
  );

  const cancel = useCallback(async () => {
    if (!job) return;
    try {
      const res = await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" });
      if (res.status === 404) markLost();
    } catch {
      // job state will update via SSE anyway
    }
  }, [job, markLost]);

  const pause = useCallback(async () => {
    if (!job) return;
    try {
      const res = await fetch(`/api/jobs/${job.id}/pause`, { method: "POST" });
      if (res.status === 404) markLost();
    } catch {
      // job state will update via SSE anyway
    }
  }, [job, markLost]);

  const reset = useCallback(() => {
    disconnect();
    setJob(null);
    setError(null);
  }, [disconnect]);

  /** Reconnect to a job that is already running (or finished) on the server. */
  const attach = useCallback(
    (jobId: string) => {
      setError(null);
      subscribe(jobId);
    },
    [subscribe],
  );

  return { job, starting, error, start, attach, cancel, pause, reset };
}
