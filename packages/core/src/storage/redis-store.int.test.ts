import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type RedisTestContext,
  createRedisContext,
  destroyRedisContext,
  stopSharedMemoryServer,
} from "../testing/redis-harness.js";
import type { AggregateRecord } from "./aggregate.js";
import { emptyHistogram, observe, percentile } from "./histogram.js";
import { RedisMetricsStore } from "./redis-store.js";

function counter(
  p: Pick<AggregateRecord, "ts" | "queue" | "jobName" | "metric"> & {
    count: number;
    errorSignature?: string | null;
  },
): AggregateRecord {
  return {
    ts: p.ts,
    bucketSeconds: 60,
    queue: p.queue,
    jobName: p.jobName,
    errorSignature: p.errorSignature ?? null,
    metric: p.metric,
    value: { kind: "counter", count: p.count },
  };
}

describe("RedisMetricsStore (integration, real Redis)", () => {
  let ctx: RedisTestContext;
  let store: RedisMetricsStore;

  beforeAll(async () => {
    ctx = await createRedisContext();
  });
  afterAll(async () => {
    await destroyRedisContext(ctx);
    await stopSharedMemoryServer();
  });
  beforeEach(async () => {
    await ctx.connection.flushall();
    store = new RedisMetricsStore({ connection: ctx.connectionOptions, keyPrefix: "bullwatch" });
  });
  afterEach(async () => {
    await store.close();
  });

  it("merges counters landing in the same bucket across writes", async () => {
    await store.write([
      counter({ ts: 60_000, queue: "email", jobName: null, metric: "completed", count: 3 }),
    ]);
    await store.write([
      counter({ ts: 60_000, queue: "email", jobName: null, metric: "completed", count: 4 }),
    ]);
    const series = await store.query({
      queue: "email",
      jobName: null,
      metric: "completed",
      from: 0,
      to: 120_000,
    });
    expect(series[0]?.points[0]?.value).toEqual({ kind: "counter", count: 7 });
  });

  it("separates per-job-name and per-error-signature series", async () => {
    await store.write([
      counter({ ts: 60_000, queue: "email", jobName: "welcome", metric: "completed", count: 1 }),
      counter({ ts: 60_000, queue: "email", jobName: "digest", metric: "completed", count: 5 }),
      counter({ ts: 60_000, queue: "email", jobName: null, metric: "failed", count: 2 }),
      counter({
        ts: 60_000,
        queue: "email",
        jobName: null,
        metric: "failed",
        count: 1,
        errorSignature: "Timeout of <n>ms exceeded",
      }),
    ]);

    const welcome = await store.query({
      queue: "email",
      jobName: "welcome",
      metric: "completed",
      from: 0,
      to: 120_000,
    });
    expect(welcome[0]?.points[0]?.value).toEqual({ kind: "counter", count: 1 });

    const plainFailed = await store.query({
      queue: "email",
      metric: "failed",
      errorSignature: null,
      from: 0,
      to: 120_000,
    });
    expect(plainFailed[0]?.points[0]?.value).toEqual({ kind: "counter", count: 2 });

    const grouped = await store.query({
      queue: "email",
      metric: "failed",
      errorSignature: "Timeout of <n>ms exceeded",
      from: 0,
      to: 120_000,
    });
    expect(grouped[0]?.points[0]?.value).toEqual({ kind: "counter", count: 1 });
  });

  it("accumulates latency histograms and yields percentiles", async () => {
    let hist = emptyHistogram();
    for (let i = 0; i < 20; i++) hist = observe(hist, i < 19 ? 10 : 5_000);
    await store.write([
      {
        ts: 60_000,
        bucketSeconds: 60,
        queue: "email",
        jobName: "welcome",
        errorSignature: null,
        metric: "run_ms",
        value: hist,
      },
    ]);
    const series = await store.query({
      queue: "email",
      jobName: "welcome",
      metric: "run_ms",
      from: 0,
      to: 120_000,
    });
    const value = series[0]?.points[0]?.value;
    expect(value?.kind).toBe("histogram");
    if (value?.kind === "histogram") {
      expect(value.totalCount).toBe(20);
      expect(percentile(value, 0.5)).toBeLessThanOrEqual(10);
      expect(percentile(value, 0.99)).toBeGreaterThanOrEqual(1_000);
    }
  });

  it("filters by time range", async () => {
    await store.write([
      counter({ ts: 60_000, queue: "email", jobName: null, metric: "completed", count: 1 }),
      counter({ ts: 180_000, queue: "email", jobName: null, metric: "completed", count: 1 }),
    ]);
    const series = await store.query({
      queue: "email",
      jobName: null,
      metric: "completed",
      from: 0,
      to: 120_000,
    });
    expect(series[0]?.points.map((p) => p.ts)).toEqual([60_000]);
  });

  it("expires buckets past the retention window", async () => {
    const shortLived = new RedisMetricsStore({
      connection: ctx.connectionOptions,
      keyPrefix: "bw-short",
      retentionMs: 150,
    });
    try {
      await shortLived.write([
        counter({ ts: 60_000, queue: "email", jobName: null, metric: "completed", count: 1 }),
      ]);
      await new Promise((r) => setTimeout(r, 300));
      const series = await shortLived.query({
        queue: "email",
        jobName: null,
        metric: "completed",
        from: 0,
        to: 120_000,
      });
      expect(series).toEqual([]);
    } finally {
      await shortLived.close();
    }
  });
});
