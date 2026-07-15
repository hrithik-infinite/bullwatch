import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type RedisTestContext,
  createRedisContext,
  destroyRedisContext,
  stopSharedMemoryServer,
} from "../testing/redis-harness.js";
import { listJobSchedulers } from "./readers.js";
import { QueueRegistry } from "./registry.js";

describe("job schedulers (integration, real Redis)", () => {
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
    registry = new QueueRegistry({ connection: ctx.connectionOptions, prefix: "bull" });
  });
  afterEach(async () => {
    await registry.close();
  });

  it("lists no schedulers on an empty queue", async () => {
    const q = registry.getQueue("email");
    await q.waitUntilReady();
    expect(await listJobSchedulers(q, { start: 0, end: 10 })).toEqual([]);
  });

  it("lists a repeatable scheduler with its cadence", async () => {
    const q = registry.getQueue("email");
    await q.upsertJobScheduler("digest", { every: 60_000 }, { name: "digest" });

    const schedulers = await listJobSchedulers(q, { start: 0, end: 10 });
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.key).toBe("digest");
    expect(schedulers[0]?.every).toBe(60_000);
    expect(schedulers[0]?.next).toBeTypeOf("number");
  });
});
