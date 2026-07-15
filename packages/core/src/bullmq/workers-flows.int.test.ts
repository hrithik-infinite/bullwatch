import { Worker } from "bullmq";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type RedisTestContext,
  createRedisContext,
  destroyRedisContext,
  stopSharedMemoryServer,
} from "../testing/redis-harness.js";
import { getFlowTree } from "./flows.js";
import { getWorkers } from "./readers.js";
import { QueueRegistry } from "./registry.js";

describe("workers & flows (integration, real Redis)", () => {
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

  it("reports no workers when none are connected", async () => {
    const q = registry.getQueue("email");
    await q.add("welcome", {});
    expect(await getWorkers(q)).toEqual([]);
  });

  it("lists a connected worker", async () => {
    const q = registry.getQueue("email");
    worker = new Worker("email", async () => ({ ok: true }), {
      connection: ctx.connectionOptions,
      prefix: "bull",
    });
    await worker.waitUntilReady();

    const workers = await getWorkers(q);
    expect(workers.length).toBeGreaterThanOrEqual(1);
    expect(workers[0]).toHaveProperty("addr");
  });

  it("builds a parent-child flow tree", async () => {
    const flow = registry.getFlowProducer();
    const tree = await flow.add({
      name: "parent",
      queueName: "email",
      data: { step: "root" },
      children: [
        { name: "child-a", queueName: "email", data: { step: "a" } },
        { name: "child-b", queueName: "email", data: { step: "b" } },
      ],
    });

    const node = await getFlowTree(flow, "email", tree.job.id as string, "bull", Date.now());
    expect(node?.job.name).toBe("parent");
    expect(node?.children).toHaveLength(2);
    expect(node?.children.map((c) => c.job.name).sort()).toEqual(["child-a", "child-b"]);
  });
});
