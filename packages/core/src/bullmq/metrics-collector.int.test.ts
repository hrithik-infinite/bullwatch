import { Worker } from "bullmq";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AggregateSeries, AggregateValue } from "../storage/aggregate.js";
import { mergeValues, percentile } from "../storage/histogram.js";
import { MemoryMetricsStore } from "../storage/memory-store.js";
import {
  type RedisTestContext,
  createRedisContext,
  destroyRedisContext,
  stopSharedMemoryServer,
} from "../testing/redis-harness.js";
import { MetricsCollector } from "./metrics-collector.js";
import { QueueRegistry } from "./registry.js";

function sumCounters(series: ReadonlyArray<AggregateSeries>): number {
  let total = 0;
  for (const s of series) {
    for (const p of s.points) if (p.value.kind === "counter") total += p.value.count;
  }
  return total;
}

function mergeHistograms(series: ReadonlyArray<AggregateSeries>): AggregateValue {
  let acc: AggregateValue = { kind: "histogram", buckets: [], totalCount: 0, sum: 0 };
  let seeded = false;
  for (const s of series) {
    for (const p of s.points) {
      if (p.value.kind !== "histogram") continue;
      acc = seeded ? mergeValues(acc, p.value) : p.value;
      seeded = true;
    }
  }
  return acc;
}

async function pollUntil(fn: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe("MetricsCollector (integration, real Redis + worker)", () => {
  let ctx: RedisTestContext;
  let registry: QueueRegistry;
  let collector: MetricsCollector;
  let worker: Worker;

  beforeAll(async () => {
    ctx = await createRedisContext();
  });

  afterAll(async () => {
    await destroyRedisContext(ctx);
    await stopSharedMemoryServer();
  });

  beforeEach(async () => {
    await ctx.connection.flushall();
    registry = new QueueRegistry({ connection: ctx.connectionOptions, prefix: "bull" });
  });

  afterEach(async () => {
    await worker?.close();
    await collector?.close();
    await registry.close();
  });

  it("builds counters and latency histograms from processed jobs", async () => {
    const store = new MemoryMetricsStore();
    collector = new MetricsCollector({
      queueName: "email",
      connection: ctx.connectionOptions,
      prefix: "bull",
      store,
    });
    await collector.start();

    worker = new Worker(
      "email",
      async (job) => {
        if (job.name === "boom") throw new Error(`Timeout of ${job.data.ms}ms exceeded`);
        return { ok: true };
      },
      { connection: ctx.connectionOptions, prefix: "bull" },
    );
    await worker.waitUntilReady();

    const q = registry.getQueue("email");
    await q.add("welcome", { userId: 1 });
    await q.add("welcome", { userId: 2 });
    await q.add("welcome", { userId: 3 });
    await q.add("boom", { ms: 5000 });

    const window = { from: 0, to: Date.now() + 120_000 };
    const ready = await pollUntil(async () => {
      const completed = sumCounters(
        await store.query({ queue: "email", jobName: null, metric: "completed", ...window }),
      );
      const failed = sumCounters(
        await store.query({
          queue: "email",
          jobName: null,
          metric: "failed",
          errorSignature: null,
          ...window,
        }),
      );
      return completed >= 3 && failed >= 1;
    });
    expect(ready).toBe(true);

    // Latency histogram exists and yields a computable percentile.
    const waitHist = mergeHistograms(
      await store.query({ queue: "email", jobName: "welcome", metric: "run_ms", ...window }),
    );
    expect(waitHist.kind).toBe("histogram");
    if (waitHist.kind === "histogram") {
      expect(waitHist.totalCount).toBeGreaterThanOrEqual(3);
      expect(percentile(waitHist, 0.5)).toBeGreaterThanOrEqual(0);
    }

    // DLQ grouping: the failure is retrievable by its normalized signature.
    const grouped = await store.query({
      queue: "email",
      metric: "failed",
      errorSignature: "Timeout of <n>ms exceeded",
      ...window,
    });
    expect(sumCounters(grouped)).toBeGreaterThanOrEqual(1);
  });
});
