import type { AggregateRecord, MetricKind } from "../storage/aggregate.js";
import { emptyHistogram, observe } from "../storage/histogram.js";

/**
 * Map a queue lifecycle event into the aggregate records the metrics store
 * persists. Pure — the QueueEvents tail (Redis) calls this and hands the result
 * to a MetricsStore. This is where "counts + latency histograms, per queue and
 * per job name" is defined, and it must stay payload-free: only counters and
 * fixed-layout histograms are produced, keyed by dimension labels.
 */

export type QueueEventKind = "completed" | "failed" | "added";

export interface MetricEvent {
  readonly kind: QueueEventKind;
  readonly queue: string;
  readonly jobName: string | null;
  /** Event time in ms. */
  readonly at: number;
  readonly waitMs?: number | null;
  readonly runMs?: number | null;
  /** Normalized failure signature, for failed events only. */
  readonly errorSignature?: string | null;
  /** Bucket width; defaults to 60s. */
  readonly bucketSeconds?: number;
}

function floorToBucket(at: number, bucketSeconds: number): number {
  const width = bucketSeconds * 1000;
  return Math.floor(at / width) * width;
}

const COUNTER_METRIC: Record<QueueEventKind, MetricKind> = {
  completed: "completed",
  failed: "failed",
  added: "added",
};

export function eventToAggregates(event: MetricEvent): AggregateRecord[] {
  const bucketSeconds = event.bucketSeconds ?? 60;
  const ts = floorToBucket(event.at, bucketSeconds);
  const { queue, jobName } = event;
  const records: AggregateRecord[] = [];

  const counter = (metric: MetricKind, name: string | null, errorSignature: string | null) => {
    records.push({
      ts,
      bucketSeconds,
      queue,
      jobName: name,
      errorSignature,
      metric,
      value: { kind: "counter", count: 1 },
    });
  };

  const histogram = (metric: MetricKind, name: string | null, valueMs: number) => {
    records.push({
      ts,
      bucketSeconds,
      queue,
      jobName: name,
      errorSignature: null,
      metric,
      value: observe(emptyHistogram(), valueMs),
    });
  };

  // Counters: per job name and queue-level (jobName=null), signature-less. When
  // jobName is already null the two records share a key — emit just one.
  const metric = COUNTER_METRIC[event.kind];
  counter(metric, jobName, null);
  if (jobName !== null) counter(metric, null, null);

  // Failure grouping: a queue-level counter dimensioned by error signature.
  if (event.kind === "failed" && event.errorSignature) {
    counter("failed", null, event.errorSignature);
  }

  // Latency histograms exist only for finished (completed/failed) jobs.
  if (event.kind === "completed" || event.kind === "failed") {
    if (typeof event.waitMs === "number") {
      histogram("wait_ms", jobName, event.waitMs);
      if (jobName !== null) histogram("wait_ms", null, event.waitMs);
    }
    if (typeof event.runMs === "number") {
      histogram("run_ms", jobName, event.runMs);
      if (jobName !== null) histogram("run_ms", null, event.runMs);
    }
  }

  return records;
}
