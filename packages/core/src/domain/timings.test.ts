import { describe, expect, it } from "vitest";
import { deriveTimings } from "./timings.js";

describe("deriveTimings", () => {
  it("computes final wait/run/total for a completed job", () => {
    const t = deriveTimings({ timestamp: 1_000, processedOn: 1_500, finishedOn: 2_500 });
    expect(t).toMatchObject({ waitMs: 500, runMs: 1_000, totalMs: 1_500 });
  });

  it("reports elapsed wait for a still-waiting job using now", () => {
    const t = deriveTimings({ timestamp: 1_000, now: 3_000 });
    expect(t.waitMs).toBe(2_000);
    expect(t.runMs).toBeNull();
    expect(t.totalMs).toBeNull();
  });

  it("reports elapsed run for an active job using now", () => {
    const t = deriveTimings({ timestamp: 1_000, processedOn: 1_500, now: 4_000 });
    expect(t.waitMs).toBe(500); // wait is final once processing has begun
    expect(t.runMs).toBe(2_500); // run is elapsed-so-far
    expect(t.totalMs).toBeNull(); // not finished
  });

  it("returns null wait when waiting and no now is provided", () => {
    const t = deriveTimings({ timestamp: 1_000 });
    expect(t.waitMs).toBeNull();
  });

  it("clamps negative durations from clock skew to zero", () => {
    const t = deriveTimings({ timestamp: 2_000, processedOn: 1_900, finishedOn: 1_950 });
    expect(t.waitMs).toBe(0);
    expect(t.runMs).toBe(50);
  });

  it("treats null/undefined processedOn and finishedOn as unset", () => {
    const t = deriveTimings({
      timestamp: 1_000,
      processedOn: null,
      finishedOn: undefined,
      now: 2_000,
    });
    expect(t.waitMs).toBe(1_000);
    expect(t.runMs).toBeNull();
  });

  it("surfaces the raw instants it was given", () => {
    const t = deriveTimings({ timestamp: 1_000, processedOn: 1_500, finishedOn: 2_500 });
    expect(t).toMatchObject({ createdAt: 1_000, processedAt: 1_500, finishedAt: 2_500 });
  });
});
