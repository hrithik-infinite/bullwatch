import { Hono } from "hono";
import { MemoryMetricsStore } from "../storage/memory-store.js";
import type { MetricsStore } from "../storage/metrics-store.js";

export interface BullwatchOptions {
  /**
   * Named BullMQ queues to expose. Accepts anything with the read surface we
   * use (getJobCounts, getJobs, getWorkers, ...). Typed as unknown for now;
   * the concrete adapter over `bullmq` Queue lands with the readers.
   */
  readonly queues?: ReadonlyArray<{ readonly name: string }>;
  /** Disable all mutating routes (retry/remove/promote/...). */
  readonly readOnly?: boolean;
  /** Metrics backend. Defaults to the in-memory rolling window (tier b). */
  readonly metricsStore?: MetricsStore;
}

export interface BullwatchApp {
  /** Web-standard fetch handler. Every framework adapter wraps this. */
  readonly fetch: (request: Request) => Response | Promise<Response>;
  readonly options: BullwatchOptions;
  readonly metricsStore: MetricsStore;
}

/**
 * Build the framework-agnostic bullwatch application. The returned `fetch`
 * handler is the single implementation; the Express/Fastify/NestJS/Hono
 * adapters are thin shells that feed it a Request and return its Response.
 */
export function createBullwatch(options: BullwatchOptions = {}): BullwatchApp {
  const metricsStore = options.metricsStore ?? new MemoryMetricsStore();
  const hono = new Hono();

  hono.get("/api/health", (c) =>
    c.json({ status: "ok", metricsStore: metricsStore.kind, readOnly: options.readOnly ?? false }),
  );

  hono.get("/api/queues", (c) =>
    // TODO: real counts via BullMQ getJobCounts once the readers land.
    c.json({ queues: (options.queues ?? []).map((q) => ({ name: q.name })) }),
  );

  return {
    fetch: (request: Request) => hono.fetch(request),
    options,
    metricsStore,
  };
}
