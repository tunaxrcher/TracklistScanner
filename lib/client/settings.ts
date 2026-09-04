"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_DJPOOL_PREFERENCES,
  DEFAULT_SCAN_SETTINGS,
  type DjPoolPreferences,
  type ScanSettings,
} from "@/lib/types";

export interface AppSettings {
  scan: ScanSettings;
  djpool: DjPoolPreferences;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  scan: DEFAULT_SCAN_SETTINGS,
  djpool: DEFAULT_DJPOOL_PREFERENCES,
};

const STORAGE_KEY = "audio-tool-settings-v1";
const CHANGE_EVENT = "app-settings-changed";

let cache: AppSettings = DEFAULT_APP_SETTINGS;
let loaded = false;

function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      scan: {
        ...DEFAULT_SCAN_SETTINGS,
        ...parsed.scan,
        // No longer user-editable; pin to the recognition sweet spot so old
        // stored values (10s) don't keep degrading accuracy.
        sampleDuration: DEFAULT_SCAN_SETTINGS.sampleDuration,
      },
      djpool: { ...DEFAULT_DJPOOL_PREFERENCES, ...parsed.djpool },
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  cache = settings;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

function getSnapshot(): AppSettings {
  return cache;
}

function getServerSnapshot(): AppSettings {
  return DEFAULT_APP_SETTINGS;
}

export function useSettings(): [AppSettings, (next: AppSettings) => void] {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    cache = loadSettings();
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }, []);
  return [settings, saveSettings];
}
