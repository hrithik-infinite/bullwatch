import type { AddressInfo } from "node:net";
import { Queue, Worker } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, createNodeServer } from "./server.js";

// Validates the Node http request/response transform against a real server
// and real Redis (via REDIS_URL, or localhost fallback).
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6399";
const conn = (() => {
  const u = new URL(REDIS_URL);
  return { host: u.hostname, port: Number(u.port || 6379), maxRetriesPerRequest: null };
})();

describe("standalone server (integration)", () => {
  const app = buildApp({
    connection: conn,
    prefix: "bull",
    queues: [],
    discover: true,
    readOnly: false,
    persistMetrics: false,
    mask: [],
    collectMetrics: true,
    metricsRescanMs: 500,
    port: 0,
  });
  const server = createNodeServer(app);
  let base: string;
  let queue: Queue;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    queue = new Queue("email", { connection: conn, prefix: "bull" });
    await queue.obliterate({ force: true }).catch(() => {});
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
  });

  it("serves health over the node http server", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("lists a queue and a job added out of band", async () => {
    await queue.add("welcome", { userId: 1 });
    const res = await fetch(`${base}/api/queues/email/jobs?state=waiting`);
    const body = (await res.json()) as { jobs: Array<{ name: string }> };
    expect(body.jobs.some((j) => j.name === "welcome")).toBe(true);
  });

  it("collects live metrics as jobs complete (collectMetrics on)", async () => {
    const worker = new Worker("email", async () => ({ ok: true }), {
      connection: conn,
      prefix: "bull",
    });
    await worker.waitUntilReady();
    try {
      // Re-scan (as the CLI's periodic rescan does) so the email queue — created
      // after buildApp construction — gets a collector before traffic flows.
      await app.startMetrics();
      await queue.add("welcome", { userId: 2 });
      await queue.add("welcome", { userId: 3 });

      let completed = 0;
      const start = Date.now();
      while (Date.now() - start < 10_000 && completed < 2) {
        const res = await fetch(
          `${base}/api/queues/email/metrics?metric=completed&from=0&to=${Date.now() + 120_000}`,
        );
        const body = (await res.json()) as {
          series: Array<{ points: Array<{ value: { kind: string; count?: number } }> }>;
        };
        completed = body.series.reduce(
          (sum, s) =>
            sum +
            s.points.reduce(
              (a, p) => a + (p.value.kind === "counter" ? (p.value.count ?? 0) : 0),
              0,
            ),
          0,
        );
        if (completed < 2) await new Promise((r) => setTimeout(r, 50));
      }
      // Both series (per-name + queue-level) count each completion, so >= 2.
      expect(completed).toBeGreaterThanOrEqual(2);
    } finally {
      await worker.close();
    }
  });
});
