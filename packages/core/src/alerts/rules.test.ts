import { describe, expect, it } from "vitest";
import type { QueueSummary } from "../bullmq/readers.js";
import type { AggregateSeries } from "../storage/aggregate.js";
import { emptyHistogram, observe } from "../storage/histogram.js";
import {
  type FailureRateRule,
  INITIAL_RULE_STATE,
  type LatencyRule,
  type QueueDepthRule,
  type RuleState,
  buildNotification,
  decide,
  evaluateDepth,
  evaluateFailureRate,
  evaluateLatency,
} from "./rules.js";

function counterSeries(count: number): AggregateSeries[] {
  return [
    {
      queue: "email",
      jobName: null,
      errorSignature: null,
      metric: "completed",
      points: [{ ts: 0, value: { kind: "counter", count } }],
    },
  ];
}

describe("evaluateFailureRate", () => {
  const rule: FailureRateRule = {
    id: "r",
    queue: "email",
    type: "failure_rate",
    windowMs: 60_000,
    threshold: 0.2,
  };

  it("breaches when the failure ratio exceeds threshold", () => {
    const ev = evaluateFailureRate(rule, counterSeries(6), counterSeries(4)); // 4/10 = 0.4
    expect(ev.value).toBeCloseTo(0.4);
    expect(ev.breached).toBe(true);
  });

  it("does not breach below threshold", () => {
    const ev = evaluateFailureRate(rule, counterSeries(9), counterSeries(1)); // 0.1
    expect(ev.breached).toBe(false);
  });

  it("withholds a breach until minSample is met", () => {
    const gated: FailureRateRule = { ...rule, minSample: 20 };
    const ev = evaluateFailureRate(gated, counterSeries(0), counterSeries(3)); // 100% but n=3
    expect(ev.value).toBe(1);
    expect(ev.saturated).toBe(false);
    expect(ev.breached).toBe(false);
  });
});

describe("evaluateDepth", () => {
  const summary: QueueSummary = {
    name: "email",
    counts: { waiting: 120, active: 3, failed: 5 },
    paused: false,
    total: 128,
  };

  it("uses the named state count", () => {
    const rule: QueueDepthRule = {
      id: "d",
      queue: "email",
      type: "queue_depth",
      state: "waiting",
      threshold: 100,
    };
    const ev = evaluateDepth(rule, summary);
    expect(ev.value).toBe(120);
    expect(ev.breached).toBe(true);
  });

  it("falls back to total when no state is given", () => {
    const rule: QueueDepthRule = { id: "d", queue: "email", type: "queue_depth", threshold: 200 };
    const ev = evaluateDepth(rule, summary);
    expect(ev.value).toBe(128);
    expect(ev.breached).toBe(false);
  });
});

describe("evaluateLatency", () => {
  const rule: LatencyRule = {
    id: "l",
    queue: "email",
    type: "latency",
    metric: "run_ms",
    windowMs: 60_000,
    thresholdMs: 1_000,
    percentile: 0.99,
  };

  it("breaches when the tail percentile exceeds thresholdMs", () => {
    let h = emptyHistogram();
    for (let i = 0; i < 100; i++) h = observe(h, i < 95 ? 10 : 5_000);
    const ev = evaluateLatency(rule, [
      {
        queue: "email",
        jobName: null,
        errorSignature: null,
        metric: "run_ms",
        points: [{ ts: 0, value: h }],
      },
    ]);
    expect(ev.value).toBeGreaterThanOrEqual(1_000);
    expect(ev.breached).toBe(true);
  });

  it("does not breach with no samples", () => {
    const ev = evaluateLatency(rule, []);
    expect(ev.breached).toBe(false);
    expect(ev.saturated).toBe(false);
  });
});

describe("decide", () => {
  const breach = {
    value: 0.5,
    breached: true,
    threshold: 0.2,
    unit: "ratio" as const,
    windowMs: 60_000,
    saturated: true,
  };
  const clear = { ...breach, value: 0.05, breached: false };

  it("notifies firing on the first breach", () => {
    const d = decide(INITIAL_RULE_STATE, breach, 1_000, 60_000);
    expect(d.kind).toBe("notify");
    if (d.kind === "notify") {
      expect(d.event).toBe("firing");
      expect(d.next.status).toBe("firing");
      expect(d.next.firstBreachAt).toBe(1_000);
    }
  });

  it("stays silent while firing within cooldown", () => {
    const firing: RuleState = {
      status: "firing",
      firstBreachAt: 1_000,
      lastNotifiedAt: 1_000,
      lastValue: 0.5,
    };
    const d = decide(firing, breach, 1_500, 60_000); // 500ms < 60s cooldown
    expect(d.kind).toBe("none");
    expect(d.next.status).toBe("firing");
    expect(d.next.firstBreachAt).toBe(1_000); // preserved
  });

  it("re-notifies after cooldown while still firing", () => {
    const firing: RuleState = {
      status: "firing",
      firstBreachAt: 1_000,
      lastNotifiedAt: 1_000,
      lastValue: 0.5,
    };
    const d = decide(firing, breach, 62_000, 60_000);
    expect(d.kind).toBe("notify");
    if (d.kind === "notify") expect(d.next.lastNotifiedAt).toBe(62_000);
  });

  it("notifies resolved when a firing rule clears", () => {
    const firing: RuleState = {
      status: "firing",
      firstBreachAt: 1_000,
      lastNotifiedAt: 1_000,
      lastValue: 0.5,
    };
    const d = decide(firing, clear, 3_000, 60_000);
    expect(d.kind).toBe("notify");
    if (d.kind === "notify") {
      expect(d.event).toBe("resolved");
      expect(d.next.status).toBe("ok");
      expect(d.next.firstBreachAt).toBeNull();
    }
  });

  it("stays silent when ok and not breached", () => {
    const d = decide(INITIAL_RULE_STATE, clear, 3_000, 60_000);
    expect(d.kind).toBe("none");
  });
});

describe("buildNotification", () => {
  it("produces a firing notification with a human message", () => {
    const rule: FailureRateRule = {
      id: "r",
      queue: "email",
      type: "failure_rate",
      windowMs: 60_000,
      threshold: 0.2,
    };
    const n = buildNotification(
      rule,
      "firing",
      {
        value: 0.42,
        breached: true,
        threshold: 0.2,
        unit: "ratio",
        windowMs: 60_000,
        saturated: true,
      },
      1_000,
      2_000,
    );
    expect(n).toMatchObject({
      schemaVersion: 1,
      event: "firing",
      ruleId: "r",
      type: "failure_rate",
      value: 0.42,
      firstBreachAt: 1_000,
      at: 2_000,
    });
    expect(n.message).toContain("firing");
  });
});
