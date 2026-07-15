import { describe, expect, it } from "vitest";
import type { AggregateRecord, MetricKind } from "../storage/aggregate.js";
import { type MetricEvent, eventToAggregates } from "./events.js";

function find(
  records: AggregateRecord[],
  metric: MetricKind,
  jobName: string | null,
  errorSignature: string | null = null,
): AggregateRecord | undefined {
  return records.find(
    (r) => r.metric === metric && r.jobName === jobName && r.errorSignature === errorSignature,
  );
}

describe("eventToAggregates", () => {
  const base: MetricEvent = {
    kind: "completed",
    queue: "email",
    jobName: "welcome",
    at: 125_000, // floors to 120_000 at 60s buckets
    waitMs: 500,
    runMs: 1_000,
  };

  it("floors the event time to the bucket boundary", () => {
    const [first] = eventToAggregates(base);
    expect(first?.ts).toBe(120_000);
    expect(first?.bucketSeconds).toBe(60);
  });

  it("emits both per-job-name and queue-level counters", () => {
    const records = eventToAggregates(base);
    expect(find(records, "completed", "welcome")?.value).toEqual({ kind: "counter", count: 1 });
    expect(find(records, "completed", null)?.value).toEqual({ kind: "counter", count: 1 });
  });

  it("emits wait and run latency histograms for finished jobs", () => {
    const records = eventToAggregates(base);
    const wait = find(records, "wait_ms", "welcome");
    const run = find(records, "run_ms", null);
    expect(wait?.value).toMatchObject({ kind: "histogram", totalCount: 1, sum: 500 });
    expect(run?.value).toMatchObject({ kind: "histogram", totalCount: 1, sum: 1_000 });
  });

  it("emits an error-signature-dimensioned counter for failures", () => {
    const records = eventToAggregates({
      kind: "failed",
      queue: "email",
      jobName: "welcome",
      at: 120_000,
      waitMs: 10,
      runMs: 20,
      errorSignature: "Timeout of <n>ms exceeded",
    });
    expect(find(records, "failed", null, "Timeout of <n>ms exceeded")?.value).toEqual({
      kind: "counter",
      count: 1,
    });
    // and a plain (signature-less) failed counter still exists for failure-rate charts
    expect(find(records, "failed", null, null)?.value).toEqual({ kind: "counter", count: 1 });
  });

  it("emits only counters for an 'added' event (no latency known yet)", () => {
    const records = eventToAggregates({ kind: "added", queue: "email", jobName: "welcome", at: 0 });
    expect(records.every((r) => r.value.kind === "counter")).toBe(true);
    expect(find(records, "added", "welcome")).toBeDefined();
    expect(find(records, "added", null)).toBeDefined();
  });

  it("all emitted records carry the queue label", () => {
    const records = eventToAggregates(base);
    expect(records.every((r) => r.queue === "email")).toBe(true);
  });

  it("does not double-count when jobName is null (job already removed)", () => {
    // With jobName=null the per-name and queue-level records share a key; the
    // store would merge them into count=2 for a single event. Guard against it.
    const records = eventToAggregates({
      kind: "completed",
      queue: "email",
      jobName: null,
      at: 0,
      waitMs: 5,
      runMs: 5,
    });
    expect(records.filter((r) => r.metric === "completed")).toHaveLength(1);
    expect(find(records, "completed", null)?.value).toEqual({ kind: "counter", count: 1 });
    expect(records.filter((r) => r.metric === "wait_ms")).toHaveLength(1);
    expect(records.filter((r) => r.metric === "run_ms")).toHaveLength(1);
  });
});
