"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { TrackEntry } from "@/lib/types";

export interface RecentItem {
  /** URL for url scans, or a `file:` pseudo-key for local file/folder scans. */
  url: string;
  title?: string;
  at: number;
  /** Tracklist saved from the last completed scan of this source. */
  tracks?: TrackEntry[];
  /** Local file/folder scans can only restore their saved tracklist. */
  kind?: "url" | "file" | "folder";
}

/**
 * Recent history store. Primary backend is the server (per Google account,
 * synced across devices); when the server has no database configured it
 * falls back to browser localStorage — same behavior as before.
 */

const STORAGE_KEY = "audio-tool-recent-v1";
const CHANGE_EVENT = "app-recent-changed";
const MAX_ITEMS = 20;

let cache: RecentItem[] = [];
let mode: "unknown" | "db" | "local" = "unknown";
let refreshStarted = false;

function notify(): void {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

// ---------- localStorage fallback ----------

function loadLocal(): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistLocal(items: RecentItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore quota errors */
  }
}

function clearLocal(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- server sync ----------

const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

/**
 * Initial load: server first, localStorage on 503/network failure.
 * A "no-db" 503 means the server has no database at all, so we switch to
 * localStorage for good. Any other failure (DB still connecting, dev server
 * compiling, network blip) is retried a few times before giving up, so a
 * slow first request doesn't strand the whole session in local mode.
 */
async function refresh(attempt = 0): Promise<void> {
  const retry = () => {
    setTimeout(() => void refresh(attempt + 1), RETRY_DELAYS_MS[attempt]);
  };
  try {
    let res: Response;
    try {
      res = await fetch("/api/recents");
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length) return retry();
      throw err;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      console.warn(`[recent-debug] refresh status=${res.status} attempt=${attempt}`, body);
      if (body?.error !== "no-db" && attempt < RETRY_DELAYS_MS.length) return retry();
      throw new Error(String(res.status));
    }
    const data = (await res.json()) as { items: RecentItem[] };
    console.warn(`[recent-debug] refresh ok attempt=${attempt} server=${data.items.length} cacheBefore=${cache.length}`);
    mode = "db";
    // One-time migration: push pre-DB localStorage history up to the account.
    const local = loadLocal();
    if (data.items.length === 0 && local.length > 0) {
      const imported = await fetch("/api/recents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: local }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<{ items: RecentItem[] }>) : null))
        .catch(() => null);
      cache = imported?.items ?? local;
      // Once imported, drop the device copy — otherwise it would be re-imported
      // into every other account that signs in on this device with an empty
      // history (and resurrect items the user already cleared).
      if (imported) clearLocal();
    } else {
      cache = data.items;
      // The account history is the source of truth now; a stale device copy
      // would only leak into the next account. Clear it.
      if (local.length > 0) clearLocal();
    }
  } catch (err) {
    console.warn(`[recent-debug] refresh FAILED attempt=${attempt}`, err);
    mode = "local";
    cache = loadLocal();
  }
  console.warn(`[recent-debug] refresh done -> cache=${cache.length} mode=${mode}`);
  notify();
}

/** Fire-and-forget server write; drops to localStorage if the DB is gone. */
function sync(request: () => Promise<Response>): void {
  if (mode === "local") {
    persistLocal(cache);
    return;
  }
  void request()
    .then((res) => {
      if (res.status === 503) throw new Error("no-db");
    })
    .catch((err) => {
      console.warn("[recent-debug] sync FAILED -> local mode", err);
      mode = "local";
      persistLocal(cache);
    });
}

// ---------- public API (same shape as the old localStorage store) ----------

/** Upsert by url/key: refresh timestamp, fill title/tracks, move to the front. */
export function addRecent(
  url: string,
  title?: string,
  tracks?: TrackEntry[],
  kind: "url" | "file" | "folder" = "url",
): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  const existing = cache.find((i) => i.url === trimmed);
  const next: RecentItem = {
    url: trimmed,
    title: title ?? existing?.title,
    tracks: tracks ?? existing?.tracks,
    kind,
    at: Date.now(),
  };
  cache = [next, ...cache.filter((i) => i.url !== trimmed)].slice(0, MAX_ITEMS);
  console.warn(`[recent-debug] addRecent ${trimmed.slice(0, 40)} tracks=${tracks?.length ?? "-"} -> cache=${cache.length} mode=${mode}`);
  notify();
  sync(() =>
    fetch("/api/recents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Send only what this update knows; the server keeps existing
      // title/tracks when they are omitted.
      body: JSON.stringify({ url: trimmed, title, tracks, kind, at: next.at }),
    }),
  );
}

export function removeRecent(url: string): void {
  cache = cache.filter((i) => i.url !== url);
  notify();
  sync(() => fetch(`/api/recents?url=${encodeURIComponent(url)}`, { method: "DELETE" }));
}

/**
 * Wipe history. `keepUrl` is the source currently on screen / being scanned —
 * that one is not history yet, and a running scan would re-save it on
 * completion anyway, so removing it would only make it "come back" later.
 */
export function clearRecent(keepUrl?: string): void {
  cache = keepUrl ? cache.filter((i) => i.url === keepUrl) : [];
  notify();
  const query = keepUrl ? `&keep=${encodeURIComponent(keepUrl)}` : "";
  sync(() => fetch(`/api/recents?all=1${query}`, { method: "DELETE" }));
}

// ---------- React binding ----------

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

function getSnapshot(): RecentItem[] {
  return cache;
}

const EMPTY: RecentItem[] = [];
function getServerSnapshot(): RecentItem[] {
  return EMPTY;
}

export function useRecent(): RecentItem[] {
  // Kick off the initial server fetch once, from an effect (not render).
  useEffect(() => {
    if (refreshStarted) return;
    refreshStarted = true;
    void refresh();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
