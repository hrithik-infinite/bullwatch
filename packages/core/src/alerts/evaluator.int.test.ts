import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AggregateRecord } from "../storage/aggregate.js";
import { MemoryMetricsStore } from "../storage/memory-store.js";
import { AlertEvaluator } from "./evaluator.js";

// Exercises the REAL webhook path (fetch → a live http server), not an injected
// deliver — proving delivery works end to end and the no-network gate holds
// (the URL is supplied at runtime, never hardcoded in the bundle).
describe("AlertEvaluator webhook delivery (integration)", () => {
  let server: Server;
  let received: Array<Record<string, unknown>>;
  let url: string;

  beforeAll(async () => {
    received = [];
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        try {
          received.push(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          /* ignore */
        }
        res.statusCode = 200;
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function counter(metric: AggregateRecord["metric"], count: number): AggregateRecord {
    return {
      ts: 60_000,
      bucketSeconds: 60,
      queue: "email",
      jobName: null,
      errorSignature: null,
      metric,
      value: { kind: "counter", count },
    };
  }

  it("POSTs a firing notification to a live webhook endpoint", async () => {
    const store = new MemoryMetricsStore();
    await store.write([counter("completed", 1), counter("failed", 9)]); // ratio 0.9

    const evaluator = new AlertEvaluator({
      store,
      getQueue: () => ({}) as Queue,
      config: {
        rules: [
          { id: "fr", queue: "email", type: "failure_rate", windowMs: 3_600_000, threshold: 0.1 },
        ],
        webhookUrls: [url],
      },
      now: () => 120_000, // window covers the ts=60_000 bucket
    });

    await evaluator.evaluateOnce();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      event: "firing",
      ruleId: "fr",
      type: "failure_rate",
      queue: "email",
    });
    expect(received[0]?.value as number).toBeCloseTo(0.9);
  });
});
