import IORedis, { type ChainableCommander, type Redis, type RedisOptions } from "ioredis";
import type { AggregateRecord, AggregateSeries, AggregateValue, MetricKind } from "./aggregate.js";
import { BUCKET_COUNT } from "./histogram.js";
import { type MetricsQuery, type MetricsStore, assertPersistable } from "./metrics-store.js";

export interface RedisMetricsStoreOptions {
  /** ioredis options or an existing instance. Options => the store owns its client. */
  readonly connection: RedisOptions | Redis;
  /** Key namespace for bullwatch aggregates. Default "bullwatch". Never "bull". */
  readonly keyPrefix?: string;
  /** Retention horizon. Default 90 days. */
  readonly retentionMs?: number;
}

const HISTOGRAM_METRICS: ReadonlySet<MetricKind> = new Set(["wait_ms", "run_ms"]);

function isHistogramMetric(metric: MetricKind): boolean {
  return HISTOGRAM_METRICS.has(metric);
}

/** Encode a label part so ":" and "*" (our separators/sentinels) can't appear raw. */
function enc(value: string): string {
  return encodeURIComponent(value);
}

function makeSeriesId(
  queue: string,
  jobName: string | null,
  errorSignature: string | null,
  metric: MetricKind,
): string {
  return [
    enc(queue),
    jobName === null ? "*" : enc(jobName),
    errorSignature === null ? "*" : enc(errorSignature),
    metric,
  ].join(":");
}

function parseSeriesId(id: string): {
  queue: string;
  jobName: string | null;
  errorSignature: string | null;
  metric: MetricKind;
} {
  const [q, j, e, metric] = id.split(":");
  return {
    queue: decodeURIComponent(q as string),
    jobName: j === "*" ? null : decodeURIComponent(j as string),
    errorSignature: e === "*" ? null : decodeURIComponent(e as string),
    metric: metric as MetricKind,
  };
}

/**
 * Tier-c storage: aggregates persisted into the user's own Redis under a
 * dedicated prefix (never `bull:*`), opt-in, so metrics survive restarts. Only
 * counts and latency-histogram buckets are written — no payloads — upholding the
 * never-persist invariant while adding no new dependency or trust boundary (the
 * user already trusts this Redis with the actual job data).
 *
 * Layout (kp = keyPrefix):
 *   {kp}:idx:{queue}:{metric}      SET   of seriesIds        (enumeration)
 *   {kp}:ts:{seriesId}             ZSET  of bucket timestamps (range queries)
 *   {kp}:b:{seriesId}:{ts}         STRING (counter) | HASH (histogram)
 * Every key carries a sliding TTL of retentionMs, so old data self-expires and
 * memory stays bounded. Merges are atomic (INCRBY / HINCRBY), so multiple
 * dashboard replicas converge without double-counting.
 */
export class RedisMetricsStore implements MetricsStore {
  readonly kind = "redis" as const;
  readonly retentionMs: number;
  private readonly kp: string;
  private readonly client: Redis;
  private readonly ownsClient: boolean;

  constructor(opts: RedisMetricsStoreOptions) {
    this.kp = opts.keyPrefix ?? "bullwatch";
    this.retentionMs = opts.retentionMs ?? 90 * 24 * 60 * 60 * 1000;
    if (opts.connection instanceof IORedis) {
      this.client = opts.connection;
      this.ownsClient = false;
    } else {
      this.client = new IORedis(opts.connection);
      this.ownsClient = true;
    }
  }

  private idxKey(queue: string, metric: MetricKind): string {
    return `${this.kp}:idx:${enc(queue)}:${metric}`;
  }
  private tsKey(seriesId: string): string {
    return `${this.kp}:ts:${seriesId}`;
  }
  private bucketKey(seriesId: string, ts: number): string {
    return `${this.kp}:b:${seriesId}:${ts}`;
  }

  async write(records: ReadonlyArray<AggregateRecord>): Promise<void> {
    assertPersistable(records);
    const ttl = this.retentionMs;
    const pipe = this.client.pipeline();
    for (const r of records) {
      const seriesId = makeSeriesId(r.queue, r.jobName, r.errorSignature, r.metric);
      const idx = this.idxKey(r.queue, r.metric);
      const ts = this.tsKey(seriesId);
      const bucket = this.bucketKey(seriesId, r.ts);

      pipe.sadd(idx, seriesId);
      pipe.pexpire(idx, ttl);
      pipe.zadd(ts, r.ts, String(r.ts));
      // Prune bucket timestamps older than retention relative to this write.
      pipe.zremrangebyscore(ts, 0, r.ts - ttl);
      pipe.pexpire(ts, ttl);

      if (r.value.kind === "counter") {
        pipe.incrby(bucket, r.value.count);
      } else {
        const buckets = r.value.buckets;
        for (let i = 0; i < buckets.length; i++) {
          const n = buckets[i] as number;
          if (n !== 0) pipe.hincrby(bucket, `b${i}`, n);
        }
        pipe.hincrby(bucket, "total", r.value.totalCount);
        pipe.hincrby(bucket, "sum", r.value.sum);
      }
      pipe.pexpire(bucket, ttl);
    }
    await pipe.exec();
  }

  async query(q: MetricsQuery): Promise<ReadonlyArray<AggregateSeries>> {
    const targets = await this.resolveSeries(q);
    const histogram = isHistogramMetric(q.metric);
    const out: AggregateSeries[] = [];

    for (const target of targets) {
      const tsList = (
        await this.client.zrangebyscore(this.tsKey(target.seriesId), q.from, `(${q.to}`)
      ).map(Number);
      if (tsList.length === 0) continue;

      const pipe = this.client.pipeline();
      for (const ts of tsList) {
        const key = this.bucketKey(target.seriesId, ts);
        if (histogram) pipe.hgetall(key);
        else pipe.get(key);
      }
      const results = await pipe.exec();
      const points: { ts: number; value: AggregateValue }[] = [];
      results?.forEach(([err, raw], i) => {
        if (err || raw === null || raw === undefined) return;
        const ts = tsList[i] as number;
        const value = histogram
          ? decodeHistogram(raw as Record<string, string>)
          : ({ kind: "counter", count: Number(raw as string) } as AggregateValue);
        if (value !== null) points.push({ ts, value });
      });
      if (points.length === 0) continue;
      points.sort((a, b) => a.ts - b.ts);
      out.push({
        queue: target.queue,
        jobName: target.jobName,
        errorSignature: target.errorSignature,
        metric: q.metric,
        points,
      });
    }
    return out;
  }

  private async resolveSeries(q: MetricsQuery): Promise<
    Array<{
      seriesId: string;
      queue: string;
      jobName: string | null;
      errorSignature: string | null;
    }>
  > {
    // Fully specified: no enumeration needed.
    if (q.queue !== undefined && q.jobName !== undefined && q.errorSignature !== undefined) {
      return [
        {
          seriesId: makeSeriesId(q.queue, q.jobName, q.errorSignature, q.metric),
          queue: q.queue,
          jobName: q.jobName,
          errorSignature: q.errorSignature,
        },
      ];
    }

    const idxKeys: string[] = [];
    if (q.queue !== undefined) {
      idxKeys.push(this.idxKey(q.queue, q.metric));
    } else {
      let cursor = "0";
      const pattern = `${this.kp}:idx:*:${q.metric}`;
      do {
        const [next, keys] = await this.client.scan(cursor, "MATCH", pattern, "COUNT", 200);
        cursor = next;
        idxKeys.push(...keys);
      } while (cursor !== "0");
    }

    const out: Array<{
      seriesId: string;
      queue: string;
      jobName: string | null;
      errorSignature: string | null;
    }> = [];
    for (const idxKey of idxKeys) {
      for (const seriesId of await this.client.smembers(idxKey)) {
        const parsed = parseSeriesId(seriesId);
        if (parsed.metric !== q.metric) continue;
        if (q.queue !== undefined && parsed.queue !== q.queue) continue;
        if (q.jobName !== undefined && parsed.jobName !== q.jobName) continue;
        if (q.errorSignature !== undefined && parsed.errorSignature !== q.errorSignature) continue;
        out.push({ seriesId, ...parsed });
      }
    }
    return out;
  }

  async close(): Promise<void> {
    if (this.ownsClient) {
      await this.client.quit().catch(() => this.client.disconnect());
    }
  }
}

function decodeHistogram(fields: Record<string, string>): AggregateValue | null {
  if (Object.keys(fields).length === 0) return null;
  const buckets = new Array(BUCKET_COUNT).fill(0);
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const v = fields[`b${i}`];
    if (v !== undefined) buckets[i] = Number(v);
  }
  return {
    kind: "histogram",
    buckets,
    totalCount: Number(fields.total ?? "0"),
    sum: Number(fields.sum ?? "0"),
  };
}

// Keep the pipeline type referenced for clarity in future extension.
export type { ChainableCommander };
