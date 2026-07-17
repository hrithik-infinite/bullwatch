import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BullwatchModule } from "./index.js";

// The /api/health route needs no Redis, so this boots a real Nest app on the
// Express platform and validates that the module mounts the dashboard under its
// configured base path and forwards to the core handler.
@Module({
  imports: [
    BullwatchModule.forRoot({
      path: "/admin/queues",
      connection: { host: "127.0.0.1", port: 6399 },
    }),
  ],
})
class AppModule {}

describe("BullwatchModule", () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the dashboard API under its mount path", async () => {
    const res = await fetch(`${base}/admin/queues/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});
