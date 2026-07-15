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

  it("enforces basic auth when configured", async () => {
    app = createBullwatch({
      connection: ctx.connectionOptions,
      prefix: "bull",
      queues: ["email"],
      metricsStore: store,
      auth: { username: "admin", password: "secret" },
    });
    const anon = await app.fetch(new Request(`${ORIGIN}/api/health`));
    expect(anon.status).toBe(401);

    const creds = Buffer.from("admin:secret").toString("base64");
    const authed = await app.fetch(
      new Request(`${ORIGIN}/api/health`, { headers: { authorization: `Basic ${creds}` } }),
    );
    expect(authed.status).toBe(200);
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

  it("pauses and resumes a queue over HTTP", async () => {
    app = build();
    await app.registry.getQueue("email").add("welcome", {});
    const pause = await getJson(app, "/api/queues/email/pause", { method: "POST" });
    expect(pause.status).toBe(200);
    expect((await getJson(app, "/api/queues/email")).body.paused).toBe(true);
    await getJson(app, "/api/queues/email/resume", { method: "POST" });
    expect((await getJson(app, "/api/queues/email")).body.paused).toBe(false);
  });

  it("bulk-removes jobs over HTTP with per-id outcomes", async () => {
    app = build();
    const a = await app.registry.getQueue("email").add("welcome", {});
    const b = await app.registry.getQueue("email").add("welcome", {});
    const res = await getJson(app, "/api/queues/email/jobs/bulk/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [a.id, b.id, "missing"] }),
    });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toHaveLength(2);
    expect(res.body.failed).toHaveLength(1);
  });

  it("omits payload when includeData=false", async () => {
    app = build();
    await app.registry.getQueue("email").add("welcome", { secret: "shh" });
    const withData = await getJson(app, "/api/queues/email/jobs?state=waiting");
    expect(withData.body.jobs[0].data).toEqual({ secret: "shh" });
    const light = await getJson(app, "/api/queues/email/jobs?state=waiting&includeData=false");
    expect(light.body.jobs[0].data).toBeNull();
    expect(light.body.jobs[0].dataOmitted).toBe(true);
  });

  it("redacts masked payload fields across list, detail, and search routes", async () => {
    app = createBullwatch({
      connection: ctx.connectionOptions,
      prefix: "bull",
      discover: true,
      metricsStore: store,
      mask: ["ssn", "**.token"],
    });
    const job = await app.registry
      .getQueue("email")
      .add("welcome", { userId: 1, ssn: "111-22-3333", auth: { token: "sekret" } });

    const list = await getJson(app, "/api/queues/email/jobs?state=waiting");
    expect(list.body.jobs[0].data).toEqual({
      userId: 1,
      ssn: "[masked]",
      auth: { token: "[masked]" },
    });

    const detail = await getJson(app, `/api/queues/email/jobs/${job.id}`);
    expect(detail.body.data.ssn).toBe("[masked]");
    expect(detail.body.data.auth.token).toBe("[masked]");

    // The real value never appears in the serialized search response.
    const search = await getJson(app, "/api/queues/email/search?q=welcome");
    expect(JSON.stringify(search.body)).not.toContain("111-22-3333");
    expect(JSON.stringify(search.body)).not.toContain("sekret");
    expect(search.body.jobs[0].data.ssn).toBe("[masked]");
  });

  it("summarizes DLQ failures by signature with samples over HTTP", async () => {
    const { Worker } = await import("bullmq");
    app = createBullwatch({
      connection: ctx.connectionOptions,
      prefix: "bull",
      queues: ["email"],
      metricsStore: store,
    });
    await app.startMetrics();

    // A worker that always fails with a timing-varying (so normalized) message.
    const worker = new Worker(
      "email",
      async (job) => {
        throw new Error(`Timeout of ${job.data.ms}ms exceeded`);
      },
      { connection: ctx.connectionOptions, prefix: "bull" },
    );
    await worker.waitUntilReady();
    try {
      const now = Date.now();
      await app.registry.getQueue("email").add("welcome", { ms: 5000 });
      await app.registry.getQueue("email").add("welcome", { ms: 3000 });

      let body: JsonBody;
      const start = Date.now();
      while (Date.now() - start < 10_000) {
        const res = await getJson(
          app,
          `/api/queues/email/failures?from=${now - 60_000}&to=${now + 120_000}&samples=true`,
        );
        body = res.body;
        if (body.totalFailures >= 2) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(body.totalFailures).toBeGreaterThanOrEqual(2);
      // Both failures normalize to one signature.
      expect(body.signatures).toHaveLength(1);
      expect(body.signatures[0].errorSignature).toBe("Timeout of <n>ms exceeded");
      expect(body.signatures[0].count).toBeGreaterThanOrEqual(2);
      expect(body.signatures[0].sampleJobIds.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(body)).not.toContain("5000ms"); // raw reason never surfaced
    } finally {
      await worker.close();
    }
  });

  it("replays a failed job over HTTP and rejects bad requests", async () => {
    const { Worker } = await import("bullmq");
    app = build();
    const worker = new Worker(
      "email",
      async (): Promise<void> => {
        throw new Error("boom");
      },
      {
        connection: ctx.connectionOptions,
        prefix: "bull",
      },
    );
    await worker.waitUntilReady();
    try {
      const job = await app.registry
        .getQueue("email")
        .add("welcome", { userId: 1 }, { attempts: 1 });

      // Wait for it to fail.
      const start = Date.now();
      while (Date.now() - start < 10_000) {
        const s = await getJson(app, "/api/queues/email");
        if ((s.body.counts.failed ?? 0) >= 1) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      // Missing `data` key → 400.
      const bad = await getJson(app, `/api/queues/email/jobs/${job.id}/replay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ removeOriginal: false }),
      });
      expect(bad.status).toBe(400);

      // Valid replay → 200 with a new job id.
      const ok = await getJson(app, `/api/queues/email/jobs/${job.id}/replay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { userId: 1, fixed: true } }),
      });
      expect(ok.status).toBe(200);
      expect(ok.body.newJobId).toBeTruthy();
      expect(ok.body.originalId).toBe(job.id);
    } finally {
      await worker.close();
    }
  });

  it("returns 409 when replaying a non-failed job", async () => {
    app = build();
    const job = await app.registry.getQueue("email").add("welcome", { userId: 1 });
    const res = await getJson(app, `/api/queues/email/jobs/${job.id}/replay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    expect(res.status).toBe(409);
  });

  it("blocks replay with 403 in read-only mode", async () => {
    app = build(true);
    const job = await app.registry.getQueue("email").add("welcome", {});
    const res = await getJson(app, `/api/queues/email/jobs/${job.id}/replay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    expect(res.status).toBe(403);
  });

  it("lists job schedulers over HTTP", async () => {
    app = build();
    await app.registry.getQueue("email").upsertJobScheduler("digest", { every: 60_000 });
    const res = await getJson(app, "/api/queues/email/schedulers");
    expect(res.body.schedulers[0]?.key).toBe("digest");
  });

  it("blocks queue-level mutations with 403 in read-only mode", async () => {
    app = build(true);
    await app.registry.getQueue("email").add("welcome", {});
    const res = await getJson(app, "/api/queues/email/pause", { method: "POST" });
    expect(res.status).toBe(403);
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
