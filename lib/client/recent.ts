"use client";

import { useSyncExternalStore } from "react";
import type { TrackEntry } from "@/lib/types";

export interface RecentItem {
  url: string;
  title?: string;
  at: number;
  /** Tracklist saved from the last completed scan of this URL. */
  tracks?: TrackEntry[];
}

const STORAGE_KEY = "audio-tool-recent-v1";
const CHANGE_EVENT = "app-recent-changed";
const MAX_ITEMS = 20;

let cache: RecentItem[] | null = null;

function load(): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(items: RecentItem[]): void {
  cache = items;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore quota errors */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Upsert by url: refresh timestamp, fill title/tracks, move to the front. */
export function addRecent(url: string, title?: string, tracks?: TrackEntry[]): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  const items = cache ?? load();
  const existing = items.find((i) => i.url === trimmed);
  const rest = items.filter((i) => i.url !== trimmed);
  const next: RecentItem = {
    url: trimmed,
    title: title ?? existing?.title,
    tracks: tracks ?? existing?.tracks,
    at: Date.now(),
  };
  persist([next, ...rest].slice(0, MAX_ITEMS));
}

export function removeRecent(url: string): void {
  const items = cache ?? load();
  persist(items.filter((i) => i.url !== url));
}

export function clearRecent(): void {
  persist([]);
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

function getSnapshot(): RecentItem[] {
  return (cache ??= load());
}

const EMPTY: RecentItem[] = [];
function getServerSnapshot(): RecentItem[] {
  return EMPTY;
}

export function useRecent(): RecentItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
