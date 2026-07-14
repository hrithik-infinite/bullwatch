/**
 * The persistence boundary for bullwatch.
 *
 * INVARIANT: job payloads are read from Redis, rendered, and forgotten. The
 * ONLY thing bullwatch may ever write to disk or to Redis is an
 * {@link AggregateRecord}. This type is deliberately shaped so that it has no
 * field capable of holding job payload content:
 *
 *   - every string field is a bounded-cardinality DIMENSION LABEL (a queue
 *     name, a job name, or a normalized error signature) — never free-form
 *     payload data, and length-capped at write time (see labels.ts);
 *   - every numeric field is a COUNT or a HISTOGRAM BUCKET.
 *
 * There is no `data`, `returnvalue`, `args`, or `payload` field, and adding one
 * would require a reviewed change to this public type. That is the enforcement:
 * the invariant is structural, not a discipline someone can forget.
 */

/** What is being measured. All are derivable without persisting payloads. */
export type MetricKind =
  | "completed" // count of jobs that completed in the bucket
  | "failed" // count of jobs that failed in the bucket
  | "added" // count of jobs enqueued in the bucket
  | "wait_ms" // latency: processedOn - timestamp
  | "run_ms"; // latency: finishedOn - processedOn

/** A plain count, or a fixed-layout latency histogram. Numbers only. */
export type AggregateValue =
  | { readonly kind: "counter"; readonly count: number }
  | {
      readonly kind: "histogram";
      /** Counts per fixed latency bucket (see histogram.ts for bounds). */
      readonly buckets: readonly number[];
      readonly totalCount: number;
      /** Sum of observed values, for computing means without payloads. */
      readonly sum: number;
    };

/**
 * The one record type bullwatch is allowed to persist.
 *
 * `queue`, `jobName`, and `errorSignature` are dimension labels only —
 * validated and length-capped by {@link assertLabel} before any write.
 */
export interface AggregateRecord {
  /** Unix ms, floored to the bucket boundary. */
  readonly ts: number;
  /** Bucket width in seconds (e.g. 60 for one-minute buckets). */
  readonly bucketSeconds: number;
  /** Queue name — dimension label. */
  readonly queue: string;
  /** Job name — dimension label, or null for a queue-level aggregate. */
  readonly jobName: string | null;
  /** Normalized failure signature — dimension label, or null. Never a raw message. */
  readonly errorSignature: string | null;
  readonly metric: MetricKind;
  readonly value: AggregateValue;
}

/** A time-ordered series returned by a {@link MetricsStore} query. */
export interface AggregateSeries {
  readonly queue: string;
  readonly jobName: string | null;
  readonly metric: MetricKind;
  readonly points: ReadonlyArray<{ readonly ts: number; readonly value: AggregateValue }>;
}
