import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryMetricsStore } from "../storage/memory-store.js";
import {
  type RedisTestContext,
  createRedisContext,
  destroyRedisContext,
  stopSharedMemoryServer,
} from "../testing/redis-harness.js";
import { type BullwatchApp, createBullwatch } from "./app.js";

const ORIGIN = "http://bullwatch.local";

// biome-ignore lint/suspicious/noExplicitAny: test helper reads arbitrary JSON bodies
type JsonBody = any;

async function getJson(
  app: BullwatchApp,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: JsonBody }> {
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, init));
  return { status: res.status, body: await res.json() };
}

describe("bullwatch HTTP app (integration, real Redis)", () => {
  let ctx: RedisTestContext;
  let app: BullwatchApp;
  let store: MemoryMetricsStore;

  beforeAll(async () => {
    ctx = await createRedisContext();
  });
  afterAll(async () => {
    await destroyRedisContext(ctx);
    await stopSharedMemoryServer();
  });
  beforeEach(async () => {
    await ctx.connection.flushall();
    store = new MemoryMetricsStore();
  });
  afterEach(async () => {
    await app?.close();
  });

  function build(readOnly = false): BullwatchApp {
    return createBullwatch({
      connection: ctx.connectionOptions,
      prefix: "bull",
      discover: true,
      readOnly,
      metricsStore: store,
    });
  }

  it("reports health", async () => {
    app = build();
    const { status, body } = await getJson(app, "/api/health");
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok", readOnly: false, metricsStore: "memory" });
  });

  it("lists queues with summaries and returns job listings", async () => {
    app = build();
    await app.registry.getQueue("email").add("welcome", { userId: 1 });
    await app.registry.getQueue("email").add("welcome", { userId: 2 });

    const queues = await getJson(app, "/api/queues");
    expect(queues.status).toBe(200);
    expect(
      queues.body.queues.find((q: { name: string }) => q.name === "email")?.counts.waiting,
    ).toBe(2);

    const jobs = await getJson(app, "/api/queues/email/jobs?state=waiting");
    expect(jobs.body.jobs).toHaveLength(2);
    expect(jobs.body.jobs[0].data).toBeDefined();
  });

  it("searches jobs by payload over HTTP", async () => {
    app = build();
    await app.registry.getQueue("email").add("welcome", { email: "alice@example.com" });
    await app.registry.getQueue("email").add("welcome", { email: "bob@example.com" });

    const { body } = await getJson(app, "/api/queues/email/search?q=email:alice@example.com");
    expect(body.jobs).toHaveLength(1);
    expect(body.scanned).toBeGreaterThanOrEqual(2);
  });

  it("serves persisted metrics series", async () => {
    app = build();
    await app.registry.getQueue("email").add("welcome", {});
    await store.write([
      {
        ts: 60_000,
        bucketSeconds: 60,
        queue: "email",
        jobName: null,
        errorSignature: null,
        metric: "completed",
        value: { kind: "counter", count: 5 },
      },
    ]);
    const { body } = await getJson(
      app,
      "/api/queues/email/metrics?metric=completed&from=0&to=120000",
    );
    expect(body.series[0].points[0].value).toEqual({ kind: "counter", count: 5 });
  });

  it("removes a job when writable", async () => {
    app = build();
    const job = await app.registry.getQueue("email").add("welcome", {});
    const del = await getJson(app, `/api/queues/email/jobs/${job.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = await getJson(app, `/api/queues/email/jobs/${job.id}`);
    expect(after.status).toBe(404);
  });

  it("blocks mutations with 403 in read-only mode", async () => {
    app = build(true);
    const job = await app.registry.getQueue("email").add("welcome", {});
    const del = await getJson(app, `/api/queues/email/jobs/${job.id}`, { method: "DELETE" });
    expect(del.status).toBe(403);
    const after = await getJson(app, `/api/queues/email/jobs/${job.id}`);
    expect(after.status).toBe(200); // still there
  });

  it("404s an unknown queue", async () => {
    app = build();
    const { status } = await getJson(app, "/api/queues/ghost");
    expect(status).toBe(404);
  });

  it("exposes a Prometheus scrape endpoint", async () => {
    app = build();
    await app.registry.getQueue("email").add("welcome", {});
    await app.registry.getQueue("email").add("welcome", {});
    const res = await app.fetch(new Request(`${ORIGIN}/metrics`));
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain('bullwatch_job_count{queue="email",state="waiting"} 2');
  });

  it("collects metrics end-to-end when started", async () => {
    const { Worker } = await import("bullmq");
    app = createBullwatch({
      connection: ctx.connectionOptions,
      prefix: "bull",
      queues: ["email"],
      readOnly: false,
      metricsStore: store,
    });
    await app.startMetrics();

    const worker = new Worker("email", async () => ({ ok: true }), {
      connection: ctx.connectionOptions,
      prefix: "bull",
    });
    await worker.waitUntilReady();
    try {
      await app.registry.getQueue("email").add("welcome", { userId: 1 });
      await app.registry.getQueue("email").add("welcome", { userId: 2 });

      let completed = 0;
      const start = Date.now();
      while (Date.now() - start < 10_000 && completed < 2) {
        const series = await store.query({
          queue: "email",
          jobName: null,
          metric: "completed",
          from: 0,
          to: Date.now() + 120_000,
        });
        completed = series.reduce(
          (sum, s) =>
            sum +
            s.points.reduce((a, p) => a + (p.value.kind === "counter" ? p.value.count : 0), 0),
          0,
        );
        if (completed < 2) await new Promise((r) => setTimeout(r, 50));
      }
      expect(completed).toBeGreaterThanOrEqual(2);
    } finally {
      await worker.close();
    }
  });
});
