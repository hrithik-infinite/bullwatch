import { describe, expect, it } from "vitest";
import type { AggregateRecord } from "./aggregate.js";
import { emptyHistogram, observe, percentile } from "./histogram.js";
import { InvalidLabelError } from "./labels.js";
import { createMarker } from "./markers.js";
import { MemoryMetricsStore } from "./memory-store.js";

function counter(
  partial: Pick<AggregateRecord, "ts" | "queue" | "jobName" | "metric"> & { count: number },
): AggregateRecord {
  return {
    ts: partial.ts,
    bucketSeconds: 60,
    queue: partial.queue,
    jobName: partial.jobName,
    errorSignature: null,
    metric: partial.metric,
    value: { kind: "counter", count: partial.count },
  };
}

describe("MemoryMetricsStore", () => {
  it("merges counters landing in the same bucket", async () => {
    const store = new MemoryMetricsStore();
    await store.write([
      counter({ ts: 60_000, queue: "email", jobName: null, metric: "completed", count: 3 }),
      counter({ ts: 60_000, queue: "email", jobName: null, metric: "completed", count: 4 }),
    ]);
    const [series] = await store.query({
      queue: "email",
      metric: "completed",
      from: 0,
      to: 120_000,
    });
    expect(series?.points).toHaveLength(1);
    expect(series?.points[0]?.value).toEqual({ kind: "counter", count: 7 });
  });

  it("keeps per-job-name dimensions separate", async () => {
    const store = new MemoryMetricsStore();
    await store.write([
      counter({ ts: 60_000, queue: "email", jobName: "welcome", metric: "completed", count: 1 }),
      counter({ ts: 60_000, queue: "email", jobName: "digest", metric: "completed", count: 5 }),
    ]);
    const welcome = await store.query({
      queue: "email",
      jobName: "welcome",
      metric: "completed",
      from: 0,
      to: 120_000,
    });
    expect(welcome[0]?.points[0]?.value).toEqual({ kind: "counter", count: 1 });
  });

  it("evicts buckets older than the retention window", async () => {
    const store = new MemoryMetricsStore({ retentionMs: 60_000 });
    await store.write([
      counter({ ts: 0, queue: "q", jobName: null, metric: "completed", count: 1 }),
      counter({ ts: 120_000, queue: "q", jobName: null, metric: "completed", count: 1 }),
    ]);
    const series = await store.query({ queue: "q", metric: "completed", from: 0, to: 1_000_000 });
    // The ts=0 bucket is older than 60s before the newest (120_000) and is dropped.
    expect(series[0]?.points.map((p) => p.ts)).toEqual([120_000]);
  });

  it("keeps signature-less and per-signature failures in separate series", async () => {
    const store = new MemoryMetricsStore();
    const failed = (errorSignature: string | null): AggregateRecord => ({
      ts: 60_000,
      bucketSeconds: 60,
      queue: "email",
      jobName: null,
      errorSignature,
      metric: "failed",
      value: { kind: "counter", count: 1 },
    });
    await store.write([failed(null), failed("Timeout of <n>ms exceeded"), failed(null)]);

    // Plain failure-rate counter: not polluted by the signatured one.
    const plain = await store.query({
      queue: "email",
      metric: "failed",
      errorSignature: null,
      from: 0,
      to: 120_000,
    });
    expect(plain[0]?.points[0]?.value).toEqual({ kind: "counter", count: 2 });

    // The signatured series is retrievable on its own for DLQ grouping.
    const grouped = await store.query({
      queue: "email",
      metric: "failed",
      errorSignature: "Timeout of <n>ms exceeded",
      from: 0,
      to: 120_000,
    });
    expect(grouped[0]?.points[0]?.value).toEqual({ kind: "counter", count: 1 });
  });

  it("records, range-filters, and queue-scopes deploy markers", async () => {
    const store = new MemoryMetricsStore();
    await store.recordMarker(createMarker({ ts: 1_000, label: "global" }, 0));
    await store.recordMarker(createMarker({ ts: 2_000, label: "email", queue: "email" }, 0));
    expect((await store.queryMarkers({ from: 0, to: 10_000 })).map((m) => m.label)).toEqual([
      "global",
      "email",
    ]);
    expect(
      (await store.queryMarkers({ from: 0, to: 10_000, queue: "billing" })).map((m) => m.label),
    ).toEqual(["global"]);
    expect((await store.queryMarkers({ from: 1_500, to: 3_000 })).map((m) => m.label)).toEqual([
      "email",
    ]);
  });

  it("evicts markers older than retention and caps total count", async () => {
    const store = new MemoryMetricsStore({ retentionMs: 1_000, maxMarkers: 2 });
    await store.recordMarker(createMarker({ ts: 0, label: "old" }, 0));
    await store.recordMarker(createMarker({ ts: 5_000, label: "new" }, 0)); // pushes cutoff to 4_000
    // "old" (ts=0) is now beyond retention relative to newest (5_000) → evicted.
    let markers = await store.queryMarkers({ from: 0, to: 10_000 });
    expect(markers.map((m) => m.label)).toEqual(["new"]);

    // maxMarkers=2: adding two more within window evicts the oldest surviving.
    await store.recordMarker(createMarker({ ts: 5_500, label: "newer" }, 0));
    await store.recordMarker(createMarker({ ts: 6_000, label: "newest" }, 0));
    markers = await store.queryMarkers({ from: 0, to: 10_000 });
    expect(markers.map((m) => m.label)).toEqual(["newer", "newest"]);
  });

  it("rejects a label long enough to be a leaked payload", async () => {
    const store = new MemoryMetricsStore();
    const record = counter({
      ts: 0,
      queue: "x".repeat(500),
      jobName: null,
      metric: "completed",
      count: 1,
    });
    await expect(store.write([record])).rejects.toBeInstanceOf(InvalidLabelError);
  });
});

describe("latency histogram", () => {
  it("approximates percentiles from bucketed observations", () => {
    let h = emptyHistogram();
    for (let i = 0; i < 100; i++) h = observe(h, i < 95 ? 10 : 5_000); // 95% fast, 5% slow
    expect(percentile(h, 0.5)).toBeLessThanOrEqual(10);
    expect(percentile(h, 0.99)).toBeGreaterThanOrEqual(1_000);
  });
});
