import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type RedisTestContext,
  createRedisContext,
  destroyRedisContext,
  stopSharedMemoryServer,
} from "../testing/redis-harness.js";
import { QueueRegistry } from "./registry.js";
import { searchJobs } from "./search.js";

describe("searchJobs (integration, real Redis)", () => {
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

  it("finds waiting jobs by payload field via read-through scan", async () => {
    const q = registry.getQueue("email");
    await q.add("welcome", { userId: 1, email: "alice@example.com" });
    await q.add("welcome", { userId: 2, email: "bob@example.com" });
    await q.add("digest", { userId: 3, email: "alice@example.com" });

    const result = await searchJobs(q, {
      query: "email:alice@example.com",
      states: ["waiting"],
      perStateLimit: 100,
      now: Date.now(),
    });
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((j) => j.data)).toEqual(
      expect.arrayContaining([
        { userId: 1, email: "alice@example.com" },
        { userId: 3, email: "alice@example.com" },
      ]),
    );
    expect(result.scanned).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("combines field predicate and job name", async () => {
    const q = registry.getQueue("email");
    await q.add("welcome", { plan: "pro" });
    await q.add("digest", { plan: "pro" });
    const result = await searchJobs(q, {
      query: "name:welcome plan:pro",
      states: ["waiting"],
      perStateLimit: 100,
      now: Date.now(),
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.name).toBe("welcome");
  });

  it("reports truncation honestly when a state hits the scan budget", async () => {
    const q = registry.getQueue("email");
    for (let i = 0; i < 10; i++) await q.add("welcome", { i });
    const result = await searchJobs(q, {
      query: "welcome",
      states: ["waiting"],
      perStateLimit: 5,
      now: Date.now(),
    });
    expect(result.scanned).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.jobs.length).toBeLessThanOrEqual(5);
  });
});
