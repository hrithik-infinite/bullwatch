import type { AddressInfo } from "node:net";
import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, createNodeServer } from "./server.js";

// Validates the Node http request/response transform against a real server
// and real Redis (via REDIS_URL, or localhost fallback).
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6399";

describe("standalone server (integration)", () => {
  const app = buildApp({
    connection: (() => {
      const u = new URL(REDIS_URL);
      return { host: u.hostname, port: Number(u.port || 6379), maxRetriesPerRequest: null };
    })(),
    prefix: "bull",
    queues: [],
    discover: true,
    readOnly: false,
    persistMetrics: false,
    port: 0,
  });
  const server = createNodeServer(app);
  let base: string;
  let queue: Queue;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const u = new URL(REDIS_URL);
    queue = new Queue("email", {
      connection: { host: u.hostname, port: Number(u.port || 6379), maxRetriesPerRequest: null },
      prefix: "bull",
    });
    await queue.obliterate({ force: true }).catch(() => {});
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
  });

  it("serves health over the node http server", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("lists a queue and a job added out of band", async () => {
    await queue.add("welcome", { userId: 1 });
    const res = await fetch(`${base}/api/queues/email/jobs?state=waiting`);
    const body = (await res.json()) as { jobs: Array<{ name: string }> };
    expect(body.jobs.some((j) => j.name === "welcome")).toBe(true);
  });
});
