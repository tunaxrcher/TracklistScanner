import type { RecentKind } from "@/lib/client/recent";

export interface ExampleUrl {
  label: string;
  url: string;
}

/** Click-to-fill sample URLs shown under the URL input on each tab. */
export const EXAMPLE_URLS: Record<RecentKind, ExampleUrl[]> = {
  tracklist: [
    { label: "DJ mix", url: "https://youtu.be/qYrEUoPjeFw" },
    { label: "Long set", url: "https://youtu.be/yYkYWiAjxws" },
  ],
  download: [{ label: "Sample song", url: "https://youtu.be/dQw4w9WgXcQ" }],
};
