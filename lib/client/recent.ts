"use client";

import { useSyncExternalStore } from "react";

export type RecentKind = "download" | "tracklist";

export interface RecentItem {
  kind: RecentKind;
  url: string;
  title?: string;
  at: number;
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

/** Upsert by (kind + url): refresh timestamp, fill title, move to the front. */
export function addRecent(kind: RecentKind, url: string, title?: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  const items = cache ?? load();
  const existing = items.find((i) => i.kind === kind && i.url === trimmed);
  const rest = items.filter((i) => !(i.kind === kind && i.url === trimmed));
  const next: RecentItem = {
    kind,
    url: trimmed,
    title: title ?? existing?.title,
    at: Date.now(),
  };
  persist([next, ...rest].slice(0, MAX_ITEMS));
}

export function removeRecent(kind: RecentKind, url: string): void {
  const items = cache ?? load();
  persist(items.filter((i) => !(i.kind === kind && i.url === url)));
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
