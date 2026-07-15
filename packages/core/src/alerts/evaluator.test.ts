import type { Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import type { AggregateSeries } from "../storage/aggregate.js";
import type { MetricsQuery, MetricsStore } from "../storage/metrics-store.js";
import { AlertEvaluator } from "./evaluator.js";
import type { AlertsConfig } from "./rules.js";

function counter(metric: AggregateSeries["metric"], count: number): AggregateSeries {
  return {
    queue: "email",
    jobName: null,
    errorSignature: null,
    metric,
    points: [{ ts: 0, value: { kind: "counter", count } }],
  };
}

/** A stub store where query() is driven by a supplied function. */
function stubStore(query: (q: MetricsQuery) => AggregateSeries[]): MetricsStore {
  return {
    kind: "memory",
    retentionMs: 0,
    write: async () => {},
    recordMarker: async () => {},
    queryMarkers: async () => [],
    query: async (q) => query(q),
  };
}

const clock = () => 1_000_000;

describe("AlertEvaluator", () => {
  const failureRuleConfig: AlertsConfig = {
    rules: [{ id: "fr", queue: "email", type: "failure_rate", windowMs: 60_000, threshold: 0.1 }],
    webhookUrls: ["http://hook.local/x"],
  };

  it("delivers a firing notification when a rule breaches", async () => {
    const store = stubStore((q) => [counter(q.metric, q.metric === "failed" ? 3 : 7)]); // 3/10 = 0.3
    const deliver = vi.fn(async () => {});
    const evaluator = new AlertEvaluator({
      store,
      getQueue: () => ({}) as Queue,
      config: failureRuleConfig,
      deliver,
      now: clock,
    });
    await evaluator.evaluateOnce();

    expect(deliver).toHaveBeenCalledTimes(1);
    const [urls, payload] = deliver.mock.calls[0] as unknown as [
      string[],
      { event: string; value: number },
    ];
    expect(urls).toEqual(["http://hook.local/x"]);
    expect(payload.event).toBe("firing");
    expect(payload.value).toBeCloseTo(0.3);
    expect(evaluator.snapshot()[0]?.status).toBe("firing");
  });

  it("does not re-deliver while firing within cooldown, then delivers resolved on recovery", async () => {
    let failing = true;
    const store = stubStore((q) => [
      counter(q.metric, q.metric === "failed" ? (failing ? 3 : 0) : 7),
    ]);
    const deliver = vi.fn(async () => {});
    const evaluator = new AlertEvaluator({
      store,
      getQueue: () => ({}) as Queue,
      config: failureRuleConfig, // default 5m cooldown
      deliver,
      now: clock, // frozen clock → within cooldown
    });

    await evaluator.evaluateOnce(); // firing
    await evaluator.evaluateOnce(); // still firing, within cooldown → silent
    expect(deliver).toHaveBeenCalledTimes(1);

    failing = false;
    await evaluator.evaluateOnce(); // recovered → resolved
    expect(deliver).toHaveBeenCalledTimes(2);
    expect((deliver.mock.calls[1] as unknown as [string[], { event: string }])[1].event).toBe(
      "resolved",
    );
    expect(evaluator.snapshot()[0]?.status).toBe("ok");
  });

  it("evaluates a queue_depth rule against a live summary", async () => {
    const fakeQueue = {
      name: "email",
      getJobCounts: async () => ({ waiting: 500 }),
      isPaused: async () => false,
    } as unknown as Queue;
    const deliver = vi.fn(async () => {});
    const evaluator = new AlertEvaluator({
      store: stubStore(() => []),
      getQueue: () => fakeQueue,
      config: {
        rules: [{ id: "d", queue: "email", type: "queue_depth", state: "waiting", threshold: 100 }],
        webhookUrls: ["http://hook.local/x"],
      },
      deliver,
      now: clock,
    });
    await evaluator.evaluateOnce();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect((deliver.mock.calls[0] as unknown as [string[], { value: number }])[1].value).toBe(500);
  });

  it("isolates a throwing rule via onError without stopping the others", async () => {
    const onError = vi.fn();
    const deliver = vi.fn(async () => {});
    const evaluator = new AlertEvaluator({
      store: stubStore((q) => {
        if (q.queue === "boom") throw new Error("query failed");
        return [counter(q.metric, q.metric === "failed" ? 5 : 5)]; // 0.5 breach
      }),
      getQueue: () => ({}) as Queue,
      config: {
        rules: [
          { id: "bad", queue: "boom", type: "failure_rate", windowMs: 1000, threshold: 0.1 },
          { id: "good", queue: "email", type: "failure_rate", windowMs: 1000, threshold: 0.1 },
        ],
        webhookUrls: ["http://hook.local/x"],
      },
      deliver,
      now: clock,
      onError,
    });
    await evaluator.evaluateOnce();
    expect(onError).toHaveBeenCalledTimes(1); // the "boom" rule
    expect(deliver).toHaveBeenCalledTimes(1); // the "good" rule still fired
  });

  it("close() is idempotent and safe before start()", async () => {
    const evaluator = new AlertEvaluator({
      store: stubStore(() => []),
      getQueue: () => ({}) as Queue,
      config: { rules: [], webhookUrls: [] },
      now: clock,
    });
    await evaluator.close();
    await evaluator.close();
  });
});
