import type { AggregateRecord, AggregateSeries } from "./aggregate.js";
import { mergeValues } from "./histogram.js";
import {
  type DeployMarker,
  type MarkerQuery,
  assertMarkerPersistable,
  markerMatchesQueue,
} from "./markers.js";
import { type MetricsQuery, type MetricsStore, assertPersistable } from "./metrics-store.js";

// A null byte separates key parts and U+0001 stands in for a null label. Error
// signatures contain spaces, so a space separator would make parseKey ambiguous;
// labels never contain these control characters.
const SEP = String.fromCharCode(0);
const NULL_LABEL = String.fromCharCode(1);

function seriesKey(
  queue: string,
  jobName: string | null,
  errorSignature: string | null,
  metric: string,
): string {
  return [queue, jobName ?? NULL_LABEL, errorSignature ?? NULL_LABEL, metric].join(SEP);
}

function parseKey(key: string): {
  queue: string;
  jobName: string | null;
  errorSignature: string | null;
  metric: string;
} {
  const [queue, jobRaw, errRaw, metric] = key.split(SEP);
  return {
    queue: queue as string,
    jobName: jobRaw === NULL_LABEL ? null : (jobRaw as string),
    errorSignature: errRaw === NULL_LABEL ? null : (errRaw as string),
    metric: metric as string,
  };
}

/**
 * Tier-b storage: an in-process rolling window of aggregates fed from the
 * QueueEvents tail. Zero dependencies, nothing at rest, dies on restart — and
 * already deeper than any OSS competitor's metrics because it carries latency
 * histograms and per-job-name dimensions live.
 *
 * Memory is bounded two ways: buckets older than `retentionMs` are evicted, and
 * distinct series are capped at `maxSeries` (top-N by recency) so unbounded
 * job-name / error-signature cardinality can't blow up the process — the
 * RabbitMQ stats-DB failure mode we explicitly avoid.
 */
export class MemoryMetricsStore implements MetricsStore {
  readonly kind = "memory" as const;
  readonly retentionMs: number;
  private readonly maxSeries: number;
  private readonly maxMarkers: number;
  private readonly series = new Map<string, Map<number, AggregateRecord>>();
  private readonly markers = new Map<string, DeployMarker>();

  constructor(opts: { retentionMs?: number; maxSeries?: number; maxMarkers?: number } = {}) {
    this.retentionMs = opts.retentionMs ?? 24 * 60 * 60 * 1000; // 24h
    this.maxSeries = opts.maxSeries ?? 2000;
    this.maxMarkers = opts.maxMarkers ?? 1000;
  }

  async write(records: ReadonlyArray<AggregateRecord>): Promise<void> {
    assertPersistable(records);
    for (const r of records) {
      const key = seriesKey(r.queue, r.jobName, r.errorSignature, r.metric);
      let buckets = this.series.get(key);
      if (!buckets) {
        if (this.series.size >= this.maxSeries) this.evictOldestSeries();
        buckets = new Map<number, AggregateRecord>();
        this.series.set(key, buckets);
      }
      const existing = buckets.get(r.ts);
      buckets.set(r.ts, existing ? { ...r, value: mergeValues(existing.value, r.value) } : r);
    }
    this.evictExpired();
  }

  query(q: MetricsQuery): Promise<ReadonlyArray<AggregateSeries>> {
    const out: AggregateSeries[] = [];
    for (const [key, buckets] of this.series) {
      const parsed = parseKey(key);
      if (parsed.metric !== q.metric) continue;
      if (q.queue !== undefined && parsed.queue !== q.queue) continue;
      if (q.jobName !== undefined && parsed.jobName !== q.jobName) continue;
      if (q.errorSignature !== undefined && parsed.errorSignature !== q.errorSignature) continue;
      const points = [...buckets.values()]
        .filter((r) => r.ts >= q.from && r.ts < q.to)
        .sort((a, b) => a.ts - b.ts)
        .map((r) => ({ ts: r.ts, value: r.value }));
      if (points.length > 0) {
        out.push({
          queue: parsed.queue,
          jobName: parsed.jobName,
          errorSignature: parsed.errorSignature,
          metric: q.metric,
          points,
        });
      }
    }
    return Promise.resolve(out);
  }

  async recordMarker(marker: DeployMarker): Promise<void> {
    assertMarkerPersistable(marker);
    this.markers.set(marker.id, marker);
    this.evictMarkers();
  }

  queryMarkers(q: MarkerQuery): Promise<ReadonlyArray<DeployMarker>> {
    const out = [...this.markers.values()]
      .filter((m) => m.ts >= q.from && m.ts < q.to && markerMatchesQueue(m, q.queue))
      .sort((a, b) => a.ts - b.ts);
    return Promise.resolve(out);
  }

  private evictMarkers(): void {
    // Drop markers older than retention relative to the newest marker.
    let newest = 0;
    for (const m of this.markers.values()) if (m.ts > newest) newest = m.ts;
    const cutoff = newest - this.retentionMs;
    for (const [id, m] of this.markers) if (m.ts < cutoff) this.markers.delete(id);
    // Cap total count: evict oldest first.
    if (this.markers.size > this.maxMarkers) {
      const byAge = [...this.markers.entries()].sort((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < byAge.length && this.markers.size > this.maxMarkers; i++) {
        this.markers.delete(byAge[i]?.[0] as string);
      }
    }
  }

  private evictExpired(): void {
    const cutoff = this.newestTs() - this.retentionMs;
    for (const [key, buckets] of this.series) {
      for (const ts of buckets.keys()) {
        if (ts < cutoff) buckets.delete(ts);
      }
      if (buckets.size === 0) this.series.delete(key);
    }
  }

  private newestTs(): number {
    let newest = 0;
    for (const buckets of this.series.values()) {
      for (const ts of buckets.keys()) if (ts > newest) newest = ts;
    }
    return newest;
  }

  private evictOldestSeries(): void {
    // Drop the series whose most-recent bucket is oldest.
    let victim: string | null = null;
    let victimNewest = Number.POSITIVE_INFINITY;
    for (const [key, buckets] of this.series) {
      let newest = 0;
      for (const ts of buckets.keys()) if (ts > newest) newest = ts;
      if (newest < victimNewest) {
        victimNewest = newest;
        victim = key;
      }
    }
    if (victim !== null) this.series.delete(victim);
  }
}
