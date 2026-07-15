import type { AggregateSeries, AggregateValue } from "../api/types.js";

// Fixed latency-histogram bounds — must match packages/core/src/storage/histogram.ts.
export const LATENCY_BOUNDS_MS: readonly number[] = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000,
];

/** Compact integer (1234 → "1.2k", 1_200_000 → "1.2M"). */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1_000) return String(Math.round(n));
  if (abs < 1_000_000) return `${(n / 1_000).toFixed(abs < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(abs < 10_000_000 ? 1 : 0)}M`;
}

/** Human duration from ms ("1240" → "1.24s", "72000" → "1m 12s"). */
export function fmtDur(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1) return "<1ms";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1_000);
  return `${m}m ${s}s`;
}

/** Relative age from a past epoch-ms timestamp ("12s", "4m", "2h", "3d"). */
export function fmtAge(tsMs: number | null, now = Date.now()): string {
  if (tsMs === null || !Number.isFinite(tsMs)) return "—";
  const d = Math.max(0, now - tsMs);
  if (d < 1_000) return "now";
  if (d < 60_000) return `${Math.floor(d / 1_000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

export function fmtClock(now = Date.now()): string {
  return new Date(now).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Approximate a percentile (0..1) from a histogram value. Matches the backend. */
export function percentile(h: AggregateValue, p: number): number {
  if (h.kind !== "histogram" || h.totalCount === 0) return 0;
  const target = p * h.totalCount;
  let cumulative = 0;
  for (let i = 0; i < h.buckets.length; i++) {
    cumulative += h.buckets[i] ?? 0;
    if (cumulative >= target) {
      return i < LATENCY_BOUNDS_MS.length
        ? (LATENCY_BOUNDS_MS[i] as number)
        : Number.POSITIVE_INFINITY;
    }
  }
  return Number.POSITIVE_INFINITY;
}

/** Merge all histogram points across series into one value. */
export function mergeHistogram(series: AggregateSeries[]): AggregateValue {
  const buckets = new Array<number>(LATENCY_BOUNDS_MS.length + 1).fill(0);
  let totalCount = 0;
  let sum = 0;
  for (const s of series) {
    for (const p of s.points) {
      if (p.value.kind === "histogram") {
        p.value.buckets.forEach((v, i) => {
          buckets[i] = (buckets[i] ?? 0) + v;
        });
        totalCount += p.value.totalCount;
        sum += p.value.sum;
      }
    }
  }
  return { kind: "histogram", buckets, totalCount, sum };
}

/** Sum all counter points across series. */
export function sumCounters(series: AggregateSeries[]): number {
  let sum = 0;
  for (const s of series)
    for (const p of s.points) if (p.value.kind === "counter") sum += p.value.count;
  return sum;
}

/** Per-bucket counter totals over a time window, as an evenly-spaced array. */
export function counterBuckets(
  series: AggregateSeries[],
  from: number,
  to: number,
  n: number,
): number[] {
  const out = new Array<number>(n).fill(0);
  const width = Math.max(1, (to - from) / n);
  for (const s of series) {
    for (const p of s.points) {
      if (p.value.kind !== "counter") continue;
      const idx = Math.min(n - 1, Math.max(0, Math.floor((p.ts - from) / width)));
      out[idx] = (out[idx] ?? 0) + p.value.count;
    }
  }
  return out;
}

export const STATE_COLOR: Record<string, string> = {
  waiting: "var(--st-waiting)",
  active: "var(--st-active)",
  completed: "var(--st-completed)",
  failed: "var(--st-failed)",
  delayed: "var(--st-delayed)",
  paused: "var(--st-paused)",
  prioritized: "var(--st-prioritized)",
};
