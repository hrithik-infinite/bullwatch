import { Worker } from "bullmq";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type RedisTestContext,
  createRedisContext,
  destroyRedisContext,
  stopSharedMemoryServer,
} from "../testing/redis-harness.js";
import {
  JobNotReplayableError,
  ReadOnlyError,
  bulkRemove,
  cleanQueue,
  pauseQueue,
  removeJob,
  replayJob,
  resumeQueue,
  retryJob,
} from "./actions.js";
import { getJobDetail, getQueueSummary } from "./readers.js";
import { QueueRegistry } from "./registry.js";

async function pollUntil(fn: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe("job actions (integration, real Redis)", () => {
  let ctx: RedisTestContext;
  let registry: QueueRegistry;
  let worker: Worker | undefined;

  beforeAll(async () => {
    ctx = await createRedisContext();
  });
  afterAll(async () => {
    await destroyRedisContext(ctx);
    await stopSharedMemoryServer();
  });
  beforeEach(async () => {
    await ctx.connection.flushall();
    registry = new QueueRegistry({ connection: ctx.connectionOptions, prefix: "bull" });
  });
  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    await registry.close();
  });

  it("removes a job", async () => {
    const q = registry.getQueue("email");
    const job = await q.add("welcome", { userId: 1 });
    await removeJob(q, job.id as string, { readOnly: false });
    expect(await getJobDetail(q, job.id as string, Date.now())).toBeNull();
  });

  it("retries a failed job back into waiting", async () => {
    const q = registry.getQueue("email");
    const w = new Worker(
      "email",
      async (): Promise<void> => {
        throw new Error("nope");
      },
      { connection: ctx.connectionOptions, prefix: "bull" },
    );
    worker = w;
    await w.waitUntilReady();
    const job = await q.add("welcome", {}, { attempts: 1 });

    const failed = await pollUntil(
      async () => ((await getQueueSummary(q)).counts.failed ?? 0) >= 1,
    );
    expect(failed).toBe(true);

    await retryJob(q, job.id as string, { readOnly: false });
    const summary = await getQueueSummary(q);
    expect(summary.counts.failed).toBe(0);
    expect((summary.counts.waiting ?? 0) + (summary.counts.active ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it("refuses mutations in read-only mode and leaves the job intact", async () => {
    const q = registry.getQueue("email");
    const job = await q.add("welcome", { userId: 1 });
    await expect(removeJob(q, job.id as string, { readOnly: true })).rejects.toBeInstanceOf(
      ReadOnlyError,
    );
    expect(await getJobDetail(q, job.id as string, Date.now())).not.toBeNull();
  });

  it("pauses and resumes a queue", async () => {
    const q = registry.getQueue("email");
    await q.add("welcome", {});
    await pauseQueue(q, { readOnly: false });
    expect((await getQueueSummary(q)).paused).toBe(true);
    await resumeQueue(q, { readOnly: false });
    expect((await getQueueSummary(q)).paused).toBe(false);
  });

  it("refuses pause in read-only mode", async () => {
    const q = registry.getQueue("email");
    await expect(pauseQueue(q, { readOnly: true })).rejects.toBeInstanceOf(ReadOnlyError);
  });

  it("bulk-removes jobs and reports per-id outcomes", async () => {
    const q = registry.getQueue("email");
    const a = await q.add("welcome", { n: 1 });
    const b = await q.add("welcome", { n: 2 });
    const result = await bulkRemove(q, [a.id as string, b.id as string, "missing"], {
      readOnly: false,
    });
    expect(result.requested).toBe(3);
    expect(result.succeeded.sort()).toEqual([a.id, b.id].sort());
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.id).toBe("missing");
  });

  it("replays a failed job as a new job with overridden data, preserving the original", async () => {
    const q = registry.getQueue("email");
    const w = new Worker(
      "email",
      async (): Promise<void> => {
        throw new Error("boom");
      },
      { connection: ctx.connectionOptions, prefix: "bull" },
    );
    worker = w;
    await w.waitUntilReady();
    const original = await q.add("welcome", { userId: 1 }, { attempts: 1, priority: 5 });
    expect(await pollUntil(async () => ((await getQueueSummary(q)).counts.failed ?? 0) >= 1)).toBe(
      true,
    );

    const result = await replayJob(
      q,
      original.id as string,
      { data: { userId: 1, fixed: true } },
      { readOnly: false },
    );
    expect(result.originalId).toBe(original.id);
    expect(result.newJobId).not.toBe(original.id);
    expect(result.removedOriginal).toBe(false);

    // Original failed job is untouched (audit trail preserved).
    const orig = await getJobDetail(q, original.id as string, Date.now());
    expect(orig?.data).toEqual({ userId: 1 });
    expect(orig?.failedReason).toBe("boom");
    // The replay carries execution-shape opts and the new payload.
    const replayed = await getJobDetail(q, result.newJobId as string, Date.now());
    expect(replayed?.data).toEqual({ userId: 1, fixed: true });
    expect((replayed?.opts as { priority?: number })?.priority).toBe(5);
  });

  it("removes the original when removeOriginal is set", async () => {
    const q = registry.getQueue("email");
    const w = new Worker(
      "email",
      async (): Promise<void> => {
        throw new Error("boom");
      },
      {
        connection: ctx.connectionOptions,
        prefix: "bull",
      },
    );
    worker = w;
    await w.waitUntilReady();
    const original = await q.add("welcome", {}, { attempts: 1 });
    expect(await pollUntil(async () => ((await getQueueSummary(q)).counts.failed ?? 0) >= 1)).toBe(
      true,
    );
    const result = await replayJob(
      q,
      original.id as string,
      { data: {}, removeOriginal: true },
      {
        readOnly: false,
      },
    );
    expect(result.removedOriginal).toBe(true);
    expect(await getJobDetail(q, original.id as string, Date.now())).toBeNull();
  });

  it("refuses to replay a non-failed job with JobNotReplayableError", async () => {
    const q = registry.getQueue("email");
    const job = await q.add("welcome", { userId: 1 }); // waiting, not failed
    await expect(
      replayJob(q, job.id as string, { data: {} }, { readOnly: false }),
    ).rejects.toBeInstanceOf(JobNotReplayableError);
  });

  it("refuses replay in read-only mode", async () => {
    const q = registry.getQueue("email");
    const job = await q.add("welcome", {});
    await expect(
      replayJob(q, job.id as string, { data: {} }, { readOnly: true }),
    ).rejects.toBeInstanceOf(ReadOnlyError);
  });

  it("cleans completed jobs", async () => {
    const q = registry.getQueue("email");
    // Nothing completed yet; clean returns an empty list, not an error.
    const removed = await cleanQueue(q, "completed", 0, 100, { readOnly: false });
    expect(Array.isArray(removed)).toBe(true);
  });
});
