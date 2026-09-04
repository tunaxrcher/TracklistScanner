import type { RecognitionProvider } from "@/lib/types";

/** Provider request timeout that also fires when the owning job is aborted. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export interface RecognitionResult {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  provider: RecognitionProvider;
}
