import type { RecognitionProvider } from "@/lib/types";

export interface RecognitionResult {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  provider: RecognitionProvider;
}
