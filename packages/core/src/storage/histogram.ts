import type { AggregateValue } from "./aggregate.js";

/**
 * Fixed latency-histogram bucket bounds, in milliseconds (upper-inclusive).
 * Log-ish spacing from sub-ms to ~5 min; the final implicit bucket catches
 * everything above the last bound. Fixed bounds keep buckets mergeable across
 * processes and cheap to store (a small array of counts, never a payload).
 */
export const LATENCY_BOUNDS_MS: readonly number[] = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000,
];

/** Number of buckets = bounds + 1 overflow bucket. */
export const BUCKET_COUNT = LATENCY_BOUNDS_MS.length + 1;

export function emptyHistogram(): AggregateValue {
  return { kind: "histogram", buckets: new Array(BUCKET_COUNT).fill(0), totalCount: 0, sum: 0 };
}

/** Index of the bucket a value falls into. */
export function bucketIndex(valueMs: number): number {
  for (let i = 0; i < LATENCY_BOUNDS_MS.length; i++) {
    if (valueMs <= (LATENCY_BOUNDS_MS[i] as number)) return i;
  }
  return LATENCY_BOUNDS_MS.length; // overflow
}

export function observe(h: AggregateValue, valueMs: number): AggregateValue {
  if (h.kind !== "histogram") throw new Error("observe() requires a histogram value");
  const buckets = h.buckets.slice();
  const i = bucketIndex(valueMs);
  buckets[i] = (buckets[i] as number) + 1;
  return { kind: "histogram", buckets, totalCount: h.totalCount + 1, sum: h.sum + valueMs };
}

/** Merge two same-layout aggregate values (for combining buckets/replicas). */
export function mergeValues(a: AggregateValue, b: AggregateValue): AggregateValue {
  if (a.kind === "counter" && b.kind === "counter") {
    return { kind: "counter", count: a.count + b.count };
  }
  if (a.kind === "histogram" && b.kind === "histogram") {
    const buckets = a.buckets.map((v, i) => v + (b.buckets[i] as number));
    return {
      kind: "histogram",
      buckets,
      totalCount: a.totalCount + b.totalCount,
      sum: a.sum + b.sum,
    };
  }
  throw new Error(`cannot merge aggregate values of kinds ${a.kind} and ${b.kind}`);
}

/** Approximate a percentile (0..1) from histogram buckets. */
export function percentile(h: AggregateValue, p: number): number {
  if (h.kind !== "histogram") throw new Error("percentile() requires a histogram value");
  if (h.totalCount === 0) return 0;
  const target = p * h.totalCount;
  let cumulative = 0;
  for (let i = 0; i < h.buckets.length; i++) {
    cumulative += h.buckets[i] as number;
    if (cumulative >= target) {
      return i < LATENCY_BOUNDS_MS.length
        ? (LATENCY_BOUNDS_MS[i] as number)
        : Number.POSITIVE_INFINITY;
    }
  }
  return Number.POSITIVE_INFINITY;
}
