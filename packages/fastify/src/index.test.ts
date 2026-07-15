import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bullwatchFastify } from "./index.js";

// /api/health needs no Redis; this validates the plugin transform and
// prefix-relative routing via fastify.inject (no socket needed).
describe("bullwatchFastify", () => {
  const app = Fastify();

  beforeAll(async () => {
    await app.register(bullwatchFastify({ connection: { host: "127.0.0.1", port: 6399 } }), {
      prefix: "/admin/queues",
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the dashboard API under its prefix", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/queues/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("404s an unknown queue through the adapter", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/queues/api/queues/ghost" });
    expect(res.statusCode).toBe(404);
  });
});
