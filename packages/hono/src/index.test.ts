import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { bullwatchHono } from "./index.js";

const CONN = { connection: { host: "127.0.0.1", port: 6399 } };

describe("bullwatchHono", () => {
  it("serves the dashboard API standalone", async () => {
    const app = bullwatchHono(CONN);
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("serves the dashboard API when mounted under a path", async () => {
    const parent = new Hono();
    parent.route("/admin/queues", bullwatchHono(CONN));
    const res = await parent.request("/admin/queues/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("404s an unknown queue through the adapter", async () => {
    const app = bullwatchHono(CONN);
    const res = await app.request("/api/queues/ghost");
    expect(res.status).toBe(404);
  });
});
