import { describe, expect, it } from "vitest";
import type { AggregateSeries } from "../storage/aggregate.js";
import { summarizeFailures } from "./failure-summary.js";

function failedSeries(
  errorSignature: string | null,
  points: Array<[ts: number, count: number]>,
): AggregateSeries {
  return {
    queue: "email",
    jobName: null,
    errorSignature,
    metric: "failed",
    points: points.map(([ts, count]) => ({ ts, value: { kind: "counter", count } })),
  };
}

describe("summarizeFailures", () => {
  const from = 0;
  const to = 12_000; // 12 buckets of 1s when trendBuckets=12

  it("ranks signatures by in-window count descending and honors topN", () => {
    const series = [
      failedSeries(null, [[0, 6]]), // total
      failedSeries("Timeout of <n>ms exceeded", [[0, 4]]),
      failedSeries("ECONNREFUSED", [[0, 2]]),
      failedSeries("bad input", [[0, 1]]),
    ];
    const out = summarizeFailures(series, { from, to, topN: 2, trendBuckets: 12 });
    expect(out.signatures.map((s) => s.errorSignature)).toEqual([
      "Timeout of <n>ms exceeded",
      "ECONNREFUSED",
    ]);
    expect(out.truncatedSignatures).toBe(true);
  });

  it("takes totalFailures from the signature-less series and computes share", () => {
    const series = [
      failedSeries(null, [[0, 10]]),
      failedSeries("Timeout of <n>ms exceeded", [[0, 4]]),
      failedSeries("ECONNREFUSED", [[0, 1]]),
    ];
    const out = summarizeFailures(series, { from, to, trendBuckets: 12 });
    expect(out.totalFailures).toBe(10);
    expect(out.classifiedFailures).toBe(5);
    expect(out.signatures[0]?.share).toBeCloseTo(0.4);
    expect(out.signatures[1]?.share).toBeCloseTo(0.1);
  });

  it("re-buckets points into the coarse trend, edges included", () => {
    const series = [
      failedSeries(null, [
        [0, 1],
        [11_999, 1],
      ]),
      failedSeries("boom", [
        [from, 3], // first bucket
        [to - 1, 5], // last bucket (exclusive upper edge)
      ]),
    ];
    const out = summarizeFailures(series, { from, to, trendBuckets: 12 });
    const trend = out.signatures[0]?.trend ?? [];
    expect(trend).toHaveLength(12);
    expect(trend[0]).toBe(3);
    expect(trend[11]).toBe(5);
  });

  it("computes delta = secondHalf - firstHalf (positive when rising)", () => {
    const rising = failedSeries("boom", [
      [1_000, 1],
      [10_000, 9],
    ]);
    const out = summarizeFailures([failedSeries(null, [[0, 10]]), rising], {
      from,
      to,
      trendBuckets: 12,
    });
    expect(out.signatures[0]?.delta).toBe(8); // 9 (second half) - 1 (first half)
  });

  it("excludes counts outside the window", () => {
    const series = [
      failedSeries(null, [
        [-5_000, 100],
        [0, 2],
      ]),
      failedSeries("boom", [
        [-5_000, 100],
        [0, 2],
        [to, 100], // exactly at exclusive upper bound → excluded
      ]),
    ];
    const out = summarizeFailures(series, { from, to, trendBuckets: 12 });
    expect(out.totalFailures).toBe(2);
    expect(out.signatures[0]?.count).toBe(2);
  });

  it("handles no failures", () => {
    const out = summarizeFailures([], { from, to });
    expect(out.totalFailures).toBe(0);
    expect(out.classifiedFailures).toBe(0);
    expect(out.signatures).toEqual([]);
    expect(out.truncatedSignatures).toBe(false);
  });

  it("degrades safely when to <= from without dividing by zero", () => {
    const out = summarizeFailures([failedSeries("boom", [[0, 3]])], { from: 5, to: 5 });
    expect(out.window.bucketCount).toBe(0);
    // Empty window excludes every point, so nothing is classified.
    expect(out.signatures).toEqual([]);
    expect(out.totalFailures).toBe(0);
  });

  it("keeps share at 0 when the total series is missing", () => {
    const out = summarizeFailures([failedSeries("boom", [[0, 3]])], { from, to, trendBuckets: 12 });
    expect(out.totalFailures).toBe(0);
    expect(out.signatures[0]?.share).toBe(0);
  });
});
