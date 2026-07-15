/**
 * DLQ / failure analysis. Pure — no Redis. Rolls the queue-level "failed"
 * aggregate series (produced by {@link eventToAggregates}: a signature-less
 * total plus one counter per normalized error signature, all at jobName=null)
 * into a ranked top-N of what is failing, each with a coarse per-window trend
 * and a first-half/second-half delta so operators see whether it's getting
 * worse. Consumes only counter values — payload-free, like everything at the
 * metrics boundary.
 */

import type { AggregateSeries, AggregateValue } from "../storage/aggregate.js";

export interface FailureTrendWindow {
  readonly from: number;
  readonly to: number;
  /** Width of each trend bucket in ms (>= 1). */
  readonly bucketMs: number;
  readonly bucketCount: number;
}

export interface FailureSignatureSummary {
  readonly errorSignature: string;
  readonly count: number;
  /** Fraction of totalFailures, 0 when there were no failures. */
  readonly share: number;
  /** Per-bucket counts, length === window.bucketCount. */
  readonly trend: readonly number[];
  /** secondHalf(trend) - firstHalf(trend): >0 means rising. */
  readonly delta: number;
}

export interface FailureSummary {
  readonly window: FailureTrendWindow;
  /** From the signature-less (errorSignature===null) series. */
  readonly totalFailures: number;
  /** Sum over signature-bearing series (may be < total if some were unclassified). */
  readonly classifiedFailures: number;
  readonly signatures: readonly FailureSignatureSummary[];
  /** True when more distinct signatures existed than topN. */
  readonly truncatedSignatures: boolean;
}

export interface SummarizeFailuresOptions {
  readonly from: number;
  readonly to: number;
  readonly topN?: number;
  readonly trendBuckets?: number;
}

function counterCount(value: AggregateValue): number {
  return value.kind === "counter" ? value.count : 0;
}

/** Sum a series' counter points within [from, to). */
function sumInWindow(series: AggregateSeries, from: number, to: number): number {
  let sum = 0;
  for (const p of series.points) {
    if (p.ts >= from && p.ts < to) sum += counterCount(p.value);
  }
  return sum;
}

function buildTrend(
  series: AggregateSeries,
  from: number,
  bucketMs: number,
  bucketCount: number,
): number[] {
  const trend = new Array<number>(bucketCount).fill(0);
  if (bucketCount === 0) return trend;
  const to = from + bucketMs * bucketCount;
  for (const p of series.points) {
    if (p.ts < from || p.ts >= to) continue;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((p.ts - from) / bucketMs)));
    trend[idx] = (trend[idx] as number) + counterCount(p.value);
  }
  return trend;
}

function halfDelta(trend: readonly number[]): number {
  const mid = Math.floor(trend.length / 2);
  let first = 0;
  let second = 0;
  for (let i = 0; i < trend.length; i++) {
    if (i < mid) first += trend[i] as number;
    else second += trend[i] as number;
  }
  return second - first;
}

export function summarizeFailures(
  series: ReadonlyArray<AggregateSeries>,
  opts: SummarizeFailuresOptions,
): FailureSummary {
  const { from, to } = opts;
  const topN = Math.max(1, Math.floor(opts.topN ?? 10));
  const width = to - from;
  const bucketCount = width > 0 ? Math.max(1, Math.floor(opts.trendBuckets ?? 24)) : 0;
  const bucketMs = bucketCount > 0 ? Math.max(1, Math.ceil(width / bucketCount)) : 1;
  const window: FailureTrendWindow = { from, to, bucketMs, bucketCount };

  let totalFailures = 0;
  let classifiedFailures = 0;
  const perSignature: FailureSignatureSummary[] = [];

  for (const s of series) {
    if (s.metric !== "failed") continue;
    const count = sumInWindow(s, from, to);
    if (s.errorSignature === null) {
      totalFailures += count; // there is only one such series, but sum defensively
      continue;
    }
    classifiedFailures += count;
    if (count === 0) continue;
    const trend = buildTrend(s, from, bucketMs, bucketCount);
    perSignature.push({
      errorSignature: s.errorSignature,
      count,
      share: 0, // filled below once totalFailures is known
      trend,
      delta: halfDelta(trend),
    });
  }

  perSignature.sort((a, b) => b.count - a.count);
  const truncatedSignatures = perSignature.length > topN;
  const signatures = perSignature.slice(0, topN).map((s) => ({
    ...s,
    share: totalFailures > 0 ? s.count / totalFailures : 0,
  }));

  return { window, totalFailures, classifiedFailures, signatures, truncatedSignatures };
}
