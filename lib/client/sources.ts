"use client";

import { DEFAULT_SOURCE_PREFS, type SourcePrefs } from "@/lib/types";

const KEY = "music.sources.v1";

interface Stored {
  prefs: SourcePrefs;
  /** Whether the user asked us to remember and skip the dialog. */
  remembered: boolean;
}

export function loadSourcePrefs(): Stored {
  if (typeof window === "undefined") return { prefs: DEFAULT_SOURCE_PREFS, remembered: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { prefs: DEFAULT_SOURCE_PREFS, remembered: false };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      prefs: { ...DEFAULT_SOURCE_PREFS, ...parsed.prefs },
      remembered: parsed.remembered === true,
    };
  } catch {
    return { prefs: DEFAULT_SOURCE_PREFS, remembered: false };
  }
}

export function saveSourcePrefs(prefs: SourcePrefs, remembered: boolean): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ prefs, remembered } satisfies Stored));
  } catch {
    // storage full/blocked — the session still works with in-memory prefs
  }
}
