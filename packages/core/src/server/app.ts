import type { ConnectionOptions, JobType, Queue } from "bullmq";
import { type Context, Hono } from "hono";
import {
  type CleanState,
  JobNotFoundError,
  ReadOnlyError,
  bulkRemove,
  bulkRetry,
  cleanQueue,
  pauseQueue,
  promoteJob,
  removeJob,
  resumeQueue,
  retryJob,
} from "../bullmq/actions.js";
import { getFlowTree } from "../bullmq/flows.js";
import { MetricsCollector } from "../bullmq/metrics-collector.js";
import {
  getJobDetail,
  getQueueSummary,
  getWorkers,
  listJobSchedulers,
  listJobs,
} from "../bullmq/readers.js";
import { QueueRegistry } from "../bullmq/registry.js";
import { searchJobs } from "../bullmq/search.js";
import type { MetricKind } from "../storage/aggregate.js";
import { MemoryMetricsStore } from "../storage/memory-store.js";
import type { MetricsStore } from "../storage/metrics-store.js";
import { renderPrometheus } from "./prometheus.js";

export interface BullwatchOptions {
  readonly connection: ConnectionOptions;
  readonly prefix?: string;
  readonly queues?: ReadonlyArray<string>;
  readonly discover?: boolean;
  readonly readOnly?: boolean;
  readonly metricsStore?: MetricsStore;
  /** Start a metrics collector per queue on startup. Default false. */
  readonly collectMetrics?: boolean;
}

export interface BullwatchApp {
  readonly fetch: (request: Request) => Response | Promise<Response>;
  readonly registry: QueueRegistry;
  readonly metricsStore: MetricsStore;
  readonly readOnly: boolean;
  /** Start (idempotently) a metrics collector for every known queue. */
  startMetrics(): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_SEARCH_STATES: JobType[] = ["waiting", "active", "completed", "failed", "delayed"];
const METRIC_KINDS: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "added",
  "wait_ms",
  "run_ms",
]);
const CLEAN_STATES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "delayed",
  "wait",
  "active",
  "paused",
  "prioritized",
]);

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Build the framework-agnostic bullwatch app. The returned `fetch` handler is
 * the single implementation every adapter wraps. Payloads flow through the read
 * routes live and are never handed to the metrics store.
 */
export function createBullwatch(options: BullwatchOptions): BullwatchApp {
  const readOnly = options.readOnly ?? false;
  const metricsStore = options.metricsStore ?? new MemoryMetricsStore();
  const registry = new QueueRegistry({
    connection: options.connection,
    prefix: options.prefix,
    queues: options.queues,
    discover: options.discover,
  });

  const hono = new Hono();

  hono.get("/api/health", (c) =>
    c.json({ status: "ok", readOnly, metricsStore: metricsStore.kind }),
  );

  hono.get("/api/queues", async (c) => {
    const names = await registry.listQueueNames();
    const summaries = await Promise.all(
      names.map((name) => getQueueSummary(registry.getQueue(name))),
    );
    return c.json({ queues: summaries });
  });

  // Resolve + authorize a queue by name for every /:name route.
  const resolve = async (name: string | undefined) => {
    if (!name || !(await registry.isAllowed(name))) return null;
    return registry.getQueue(name);
  };

  hono.get("/api/queues/:name", async (c) => {
    const queue = await resolve(c.req.param("name"));
    if (!queue) return c.json({ error: "queue not found" }, 404);
    return c.json(await getQueueSummary(queue));
  });

  hono.get("/api/queues/:name/jobs", async (c) => {
    const queue = await resolve(c.req.param("name"));
    if (!queue) return c.json({ error: "queue not found" }, 404);
    const state = (c.req.query("state") ?? "waiting") as JobType;
    const start = clampInt(c.req.query("start"), 0, 0, Number.MAX_SAFE_INTEGER);
    const end = clampInt(c.req.query("end"), start + 19, start, start + 999);
    const includeData = c.req.query("includeData") !== "false";
    const jobs = await listJobs(queue, state, { start, end }, Date.now(), { includeData });
    return c.json({ jobs, state, start, end });
  });

  hono.get("/api/queues/:name/schedulers", async (c) => {
    const queue = await resolve(c.req.param("name"));
    if (!queue) return c.json({ error: "queue not found" }, 404);
    const start = clampInt(c.req.query("start"), 0, 0, Number.MAX_SAFE_INTEGER);
    const end = clampInt(c.req.query("end"), start + 49, start, start + 999);
    return c.json({ schedulers: await listJobSchedulers(queue, { start, end }) });
  });

  hono.get("/api/queues/:name/search", async (c) => {
    const queue = await resolve(c.req.param("name"));
    if (!queue) return c.json({ error: "queue not found" }, 404);
    const query = c.req.query("q") ?? "";
    const statesParam = c.req.query("states");
    const states = statesParam
      ? (statesParam.split(",").filter(Boolean) as JobType[])
      : DEFAULT_SEARCH_STATES;
    const perStateLimit = clampInt(c.req.query("limit"), 100, 1, 1000);
    const result = await searchJobs(queue, { query, states, perStateLimit, now: Date.now() });
    return c.json(result);
  });

  hono.get("/api/queues/:name/metrics", async (c) => {
    const queue = await resolve(c.req.param("name"));
    if (!queue) return c.json({ error: "queue not found" }, 404);
    const metric = c.req.query("metric") ?? "";
    if (!METRIC_KINDS.has(metric)) return c.json({ error: "unknown metric" }, 400);
    const jobNameParam = c.req.query("jobName");
    const now = Date.now();
    const series = await metricsStore.query({
      queue: queue.name,
      jobName: jobNameParam === undefined ? undefined : jobNameParam === "" ? null : jobNameParam,
      metric: metric as MetricKind,
      from: clampInt(c.req.query("from"), 0, 0, Number.MAX_SAFE_INTEGER),
      to: clampInt(c.req.query("to"), now, 0, Number.MAX_SAFE_INTEGER),
    });
    return c.json({ series });
  });

  hono.get("/api/queues/:name/workers", async (c) => {
    const queue = await resolve(c.req.param("name"));
    if (!queue) return c.json({ error: "queue not found" }, 404);
    return c.json({ workers: await getWorkers(queue) });
  });

  hono.get("/api/queues/:name/flows/:id", async (c) => {
    const queue = await resolve(c.req.param("name"));
    if (!queue) return c.json({ error: "queue not found" }, 404);
    const tree = await getFlowTree(
      registry.getFlowProducer(),
      queue.name,
      c.req.param("id"),
      options.prefix ?? "bull",
      Date.now(),
    );
    return tree ? c.json(tree) : c.json({ error: "flow not found" }, 404);
  });

  hono.get("/api/queues/:name/jobs/:id", async (c) => {
    const queue = await resolve(c.req.param("name"));
    if (!queue) return c.json({ error: "queue not found" }, 404);
    const job = await getJobDetail(queue, c.req.param("id"), Date.now());
    return job ? c.json(job) : c.json({ error: "job not found" }, 404);
  });

  // Prometheus scrape endpoint — the user's own Prometheus pulls from here.
  hono.get("/metrics", async (c) => {
    const names = await registry.listQueueNames();
    const summaries = await Promise.all(names.map((n) => getQueueSummary(registry.getQueue(n))));
    return c.text(renderPrometheus(summaries), 200, {
      "content-type": "text/plain; version=0.0.4",
    });
  });

  const mutate = async (c: Context, action: (queue: Queue, id: string) => Promise<void>) => {
    const queue = await resolve(c.req.param("name"));
    if (!queue) return c.json({ error: "queue not found" }, 404);
    const id = c.req.param("id");
    if (!id) return c.json({ error: "job id required" }, 400);
    try {
      await action(queue, id);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ReadOnlyError) return c.json({ error: err.message }, 403);
      if (err instanceof JobNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  };

  hono.post("/api/queues/:name/jobs/:id/retry", (c) =>
    mutate(c, (queue, id) => retryJob(queue, id, { readOnly })),
  );
  hono.post("/api/queues/:name/jobs/:id/promote", (c) =>
    mutate(c, (queue, id) => promoteJob(queue, id, { readOnly })),
  );
  hono.delete("/api/queues/:name/jobs/:id", (c) =>
    mutate(c, (queue, id) => removeJob(queue, id, { readOnly })),
  );

  // Queue-level and bulk mutations: resolve + authorize, map domain errors.
  const guard = async (c: Context, fn: (queue: Queue) => Promise<Response>): Promise<Response> => {
    const queue = await resolve(c.req.param("name"));
    if (!queue) return c.json({ error: "queue not found" }, 404);
    try {
      return await fn(queue);
    } catch (err) {
      if (err instanceof ReadOnlyError) return c.json({ error: err.message }, 403);
      if (err instanceof JobNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  };

  hono.post("/api/queues/:name/pause", (c) =>
    guard(c, async (queue) => {
      await pauseQueue(queue, { readOnly });
      return c.json({ ok: true });
    }),
  );
  hono.post("/api/queues/:name/resume", (c) =>
    guard(c, async (queue) => {
      await resumeQueue(queue, { readOnly });
      return c.json({ ok: true });
    }),
  );
  hono.post("/api/queues/:name/clean", (c) =>
    guard(c, async (queue) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        state?: string;
        graceMs?: number;
        limit?: number;
      };
      if (!body.state || !CLEAN_STATES.has(body.state)) {
        return c.json({ error: "invalid or missing state" }, 400);
      }
      const graceMs = clampInt(String(body.graceMs ?? 0), 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = clampInt(String(body.limit ?? 1000), 1000, 1, 100_000);
      const removed = await cleanQueue(queue, body.state as CleanState, graceMs, limit, {
        readOnly,
      });
      return c.json({ removed });
    }),
  );
  const bulkRoute = (action: typeof bulkRetry) => (c: Context) =>
    guard(c, async (queue) => {
      const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((i): i is string => typeof i === "string")
        : [];
      return c.json(await action(queue, ids, { readOnly }));
    });
  hono.post("/api/queues/:name/jobs/bulk/retry", bulkRoute(bulkRetry));
  hono.post("/api/queues/:name/jobs/bulk/remove", bulkRoute(bulkRemove));

  const collectors = new Map<string, MetricsCollector>();
  const startMetrics = async (): Promise<void> => {
    const names = new Set<string>(options.queues ?? []);
    for (const name of await registry.listQueueNames()) names.add(name);
    await Promise.all(
      [...names]
        .filter((name) => !collectors.has(name))
        .map(async (name) => {
          const collector = new MetricsCollector({
            queueName: name,
            connection: options.connection,
            prefix: options.prefix,
            store: metricsStore,
          });
          await collector.start();
          collectors.set(name, collector);
        }),
    );
  };

  if (options.collectMetrics) void startMetrics();

  return {
    fetch: (request: Request) => hono.fetch(request),
    registry,
    metricsStore,
    readOnly,
    startMetrics,
    close: async () => {
      await Promise.all([...collectors.values()].map((collector) => collector.close()));
      collectors.clear();
      await registry.close();
    },
  };
}
