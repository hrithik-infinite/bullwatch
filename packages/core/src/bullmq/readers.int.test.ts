import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type RedisTestContext,
  createRedisContext,
  destroyRedisContext,
  stopSharedMemoryServer,
} from "../testing/redis-harness.js";
import { getJobDetail, getQueueSummary, listJobs } from "./readers.js";
import { QueueRegistry } from "./registry.js";

describe("bullmq readers (integration, real Redis)", () => {
  let ctx: RedisTestContext;
  let registry: QueueRegistry;

  beforeAll(async () => {
    ctx = await createRedisContext();
  });

  afterAll(async () => {
    await destroyRedisContext(ctx);
    await stopSharedMemoryServer();
  });

  beforeEach(async () => {
    await ctx.connection.flushall();
    registry = new QueueRegistry({
      connection: ctx.connectionOptions,
      prefix: "bull",
      discover: true,
    });
  });

  afterEach(async () => {
    await registry.close();
  });

  it("reports job counts and unpaused state", async () => {
    const q = registry.getQueue("email");
    await q.add("welcome", { userId: 1 });
    await q.add("welcome", { userId: 2 });
    const summary = await getQueueSummary(q);
    expect(summary.name).toBe("email");
    expect(summary.counts.waiting).toBe(2);
    expect(summary.paused).toBe(false);
    expect(summary.total).toBeGreaterThanOrEqual(2);
  });

  it("reflects paused state", async () => {
    const q = registry.getQueue("email");
    await q.add("welcome", {});
    await q.pause();
    const summary = await getQueueSummary(q);
    expect(summary.paused).toBe(true);
  });

  it("lists waiting jobs as DTOs with payload and derived timings", async () => {
    const q = registry.getQueue("email");
    await q.add("welcome", { userId: 7 });
    const jobs = await listJobs(q, "waiting", { start: 0, end: 10 }, Date.now());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe("welcome");
    expect(jobs[0]?.data).toEqual({ userId: 7 });
    expect(jobs[0]?.timings.waitMs).toBeGreaterThanOrEqual(0);
    expect(jobs[0]?.timings.runMs).toBeNull(); // not processed yet
  });

  it("fetches a single job's detail and returns null for a missing id", async () => {
    const q = registry.getQueue("email");
    const added = await q.add("welcome", { userId: 9 });
    const detail = await getJobDetail(q, added.id as string, Date.now());
    expect(detail?.data).toEqual({ userId: 9 });
    expect(await getJobDetail(q, "does-not-exist", Date.now())).toBeNull();
  });

  it("discovers queues by scanning meta keys", async () => {
    await registry.getQueue("email").add("welcome", {});
    await registry.getQueue("billing").add("charge", {});
    const names = await registry.listQueueNames();
    expect(names).toContain("email");
    expect(names).toContain("billing");
  });

  it("honors an explicit queue allow-list without discovery", async () => {
    await registry.close();
    registry = new QueueRegistry({
      connection: ctx.connectionOptions,
      prefix: "bull",
      queues: ["email"],
      discover: false,
    });
    await registry.getQueue("email").add("welcome", {});
    await registry.getQueue("billing").add("charge", {}); // exists in Redis but not allow-listed
    expect(await registry.listQueueNames()).toEqual(["email"]);
  });
});
