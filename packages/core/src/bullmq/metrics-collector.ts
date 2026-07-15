import { type ConnectionOptions, Queue, QueueEvents } from "bullmq";
import { errorSignature } from "../domain/error-signature.js";
import { type MetricEvent, eventToAggregates } from "../domain/events.js";
import { deriveTimings } from "../domain/timings.js";
import type { MetricsStore } from "../storage/metrics-store.js";

export interface MetricsCollectorOptions {
  readonly queueName: string;
  readonly connection: ConnectionOptions;
  readonly prefix?: string;
  readonly store: MetricsStore;
  /** Injectable clock (tests). Defaults to Date.now. */
  readonly now?: () => number;
}

/**
 * Tails a queue's event stream and feeds aggregates into a MetricsStore. This is
 * the live metrics pipeline: QueueEvents → derive timings → eventToAggregates →
 * store. It reads job hashes to recover wait/run latency (the event stream alone
 * has no timings); if a job was already removed by removeOnComplete, the event
 * still counts, just without latency — never a crash, never a payload persisted.
 */
export class MetricsCollector {
  private readonly events: QueueEvents;
  private readonly queue: Queue;
  private readonly store: MetricsStore;
  private readonly now: () => number;
  private started = false;

  constructor(opts: MetricsCollectorOptions) {
    const prefix = opts.prefix ?? "bull";
    this.events = new QueueEvents(opts.queueName, { connection: opts.connection, prefix });
    this.queue = new Queue(opts.queueName, { connection: opts.connection, prefix });
    this.store = opts.store;
    this.now = opts.now ?? (() => Date.now());
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.events.on("completed", ({ jobId }) => {
      void this.onFinished(jobId, "completed");
    });
    this.events.on("failed", ({ jobId, failedReason }) => {
      void this.onFinished(jobId, "failed", failedReason);
    });
    this.events.on("added", ({ name }) => {
      void this.onAdded(name ?? null);
    });
    // Subscribe from the current stream tip before returning, so callers can add
    // jobs immediately after start() without racing the subscription.
    await this.events.waitUntilReady();
    this.started = true;
  }

  private async onFinished(
    jobId: string,
    kind: "completed" | "failed",
    failedReason?: string,
  ): Promise<void> {
    const job = await this.queue.getJob(jobId).catch(() => undefined);
    const timings = job
      ? deriveTimings({
          timestamp: job.timestamp,
          processedOn: job.processedOn,
          finishedOn: job.finishedOn,
        })
      : null;
    const event: MetricEvent = {
      kind,
      queue: this.queue.name,
      jobName: job?.name ?? null,
      at: job?.finishedOn ?? this.now(),
      waitMs: timings?.waitMs ?? null,
      runMs: timings?.runMs ?? null,
      errorSignature:
        kind === "failed" ? errorSignature(failedReason ?? job?.failedReason ?? null) : null,
    };
    await this.store.write(eventToAggregates(event));
  }

  private async onAdded(name: string | null): Promise<void> {
    await this.store.write(
      eventToAggregates({ kind: "added", queue: this.queue.name, jobName: name, at: this.now() }),
    );
  }

  async close(): Promise<void> {
    await this.events.close();
    await this.queue.close();
  }
}
