/**
 * Pluggable sampling strategies. The scanner asks the strategy where to
 * sample next based on what the last samples found, so new strategies can be
 * added later without touching the scanner.
 */

export type SampleOutcome = "same-song" | "new-song" | "no-match";

export interface SamplingStrategy {
  /** First sample position (seconds). */
  first(duration: number): number;
  /**
   * Next sample position after a result at `position`, or null to stop.
   * `sameStreak` = how many consecutive samples matched the same song.
   */
  next(position: number, duration: number, outcome: SampleOutcome, sameStreak: number): number | null;
  /** Rough estimate of total samples, for progress display. */
  estimateTotal(duration: number): number;
}

/** Fixed interval: 0, N, 2N, 3N, ... */
export class FixedIntervalStrategy implements SamplingStrategy {
  constructor(private readonly interval: number) {}

  first(): number {
    return 0;
  }

  next(position: number, duration: number): number | null {
    const next = position + this.interval;
    return next < duration ? next : null;
  }

  estimateTotal(duration: number): number {
    return Math.max(1, Math.ceil(duration / this.interval));
  }
}

/**
 * Smart scan: starts at the base interval; while the same song keeps being
 * detected the gap widens (up to 3× base) to save API calls. As soon as the
 * song changes or recognition fails, the gap resets to the base interval.
 */
export class SmartSamplingStrategy implements SamplingStrategy {
  constructor(private readonly interval: number) {}

  first(): number {
    return 0;
  }

  next(
    position: number,
    duration: number,
    outcome: SampleOutcome,
    sameStreak: number,
  ): number | null {
    let gap = this.interval;
    if (outcome === "same-song") {
      if (sameStreak >= 4) gap = this.interval * 3;
      else if (sameStreak >= 2) gap = this.interval * 2;
    }
    // On a change or uncertainty, keep the base (highest) frequency.
    const next = position + gap;
    return next < duration ? next : null;
  }

  estimateTotal(duration: number): number {
    return Math.max(1, Math.ceil(duration / this.interval));
  }
}

export function createStrategy(smartScan: boolean, interval: number): SamplingStrategy {
  return smartScan ? new SmartSamplingStrategy(interval) : new FixedIntervalStrategy(interval);
}
