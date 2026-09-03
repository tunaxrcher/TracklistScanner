"use client";

import { useEffect } from "react";

/**
 * Marks the document as hydrated. Paired with the inline script in
 * app/layout.tsx: if this never runs after a history/restore navigation, the
 * page is stuck on a static shell (stale JS chunks from Chrome's cache) and
 * the script reloads once to fetch fresh ones.
 */
export function HydrationGuard() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1";
    // Hydrated fine — allow the guard to fire again on a future restore.
    sessionStorage.removeItem("hydration-reloaded");
  }, []);
  return null;
}
