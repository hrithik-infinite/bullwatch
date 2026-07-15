import type { AggregateRecord, AggregateSeries, MetricKind } from "./aggregate.js";
import { assertLabel } from "./labels.js";
import type { DeployMarker, MarkerQuery } from "./markers.js";

/** A query against persisted aggregates. */
export interface MetricsQuery {
  readonly queue?: string;
  /** null = queue-level only; a string = that job name; undefined = any. */
  readonly jobName?: string | null;
  /** null = signature-less only; a string = that signature; undefined = any. */
  readonly errorSignature?: string | null;
  readonly metric: MetricKind;
  /** Inclusive lower bound, Unix ms. */
  readonly from: number;
  /** Exclusive upper bound, Unix ms. */
  readonly to: number;
}

/**
 * The sole persistence interface in bullwatch. Implementations may keep
 * aggregates in memory (tier b) or in the user's Redis under our own prefix
 * (tier c). No implementation may accept anything but {@link AggregateRecord}s
 * — that is what keeps payloads off disk by construction.
 */
export interface MetricsStore {
  readonly kind: "memory" | "redis";
  write(records: ReadonlyArray<AggregateRecord>): Promise<void>;
  query(q: MetricsQuery): Promise<ReadonlyArray<AggregateSeries>>;
  /**
   * Record a deploy marker (structured, length-capped, payload-free — see
   * {@link assertMarkerPersistable}). Markers share the store's retention.
   */
  recordMarker(marker: DeployMarker): Promise<void>;
  /** Query deploy markers in a time range, for chart overlay. */
  queryMarkers(q: MarkerQuery): Promise<ReadonlyArray<DeployMarker>>;
  /** Retention horizon in ms; older buckets and markers are dropped. */
  readonly retentionMs: number;
}

/**
 * Validate a batch at the persistence boundary. Every store MUST call this
 * before persisting. Throws on any malformed record or suspicious label.
 */
export function assertPersistable(records: ReadonlyArray<AggregateRecord>): void {
  for (const r of records) {
    assertLabel("queue", r.queue, { nullable: false });
    assertLabel("jobName", r.jobName, { nullable: true });
    assertLabel("errorSignature", r.errorSignature, { nullable: true });
    if (!Number.isFinite(r.ts) || r.ts < 0) {
      throw new Error(`invalid ts: ${r.ts}`);
    }
    if (!Number.isInteger(r.bucketSeconds) || r.bucketSeconds <= 0) {
      throw new Error(`invalid bucketSeconds: ${r.bucketSeconds}`);
    }
  }
}
