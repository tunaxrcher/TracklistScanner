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
        // If the stream drops, fall back to one status fetch.
        fetch(`/api/jobs/${jobId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data: Job | null) => data && setJob(data))
          .catch(() => {});
      };
    },
    [disconnect],
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
      await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" });
    } catch {
      // job state will update via SSE anyway
    }
  }, [job]);

  const reset = useCallback(() => {
    disconnect();
    setJob(null);
    setError(null);
  }, [disconnect]);

  return { job, starting, error, start, cancel, reset };
}
