import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bullwatchExpress } from "./index.js";

// The /api/health route needs no Redis, so this validates the adapter's
// request/response transform and mount-relative base-path handling in
// isolation — the failure mode that a root-only test would miss.
describe("bullwatchExpress", () => {
  let server: ReturnType<express.Express["listen"]>;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use("/admin/queues", bullwatchExpress({ connection: { host: "127.0.0.1", port: 6399 } }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves the dashboard API under its mount path", async () => {
    const res = await fetch(`${base}/admin/queues/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});
