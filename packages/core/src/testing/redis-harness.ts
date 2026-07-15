import IORedis from "ioredis";
import { RedisMemoryServer } from "redis-memory-server";

/**
 * Test-only Redis harness. Integration tests run against a REAL Redis because
 * BullMQ's behavior lives in Lua scripts that mocks don't reproduce — testing
 * against a fake is exactly how a competitor shipped a dead code path that
 * "looked right" but threw at runtime.
 *
 * Resolution order:
 *   1. `REDIS_URL` env var (point it at Docker locally, or a CI service
 *      container) — instant, no binary boot.
 *   2. redis-memory-server — downloads/boots a real redis-server binary in
 *      process, so tests work with zero setup.
 *
 * Not part of the published package (never imported by src/index.ts).
 */
export interface RedisTestContext {
  readonly connection: IORedis;
  readonly url: string;
  /** ioredis connection options BullMQ needs (maxRetriesPerRequest: null). */
  readonly connectionOptions: { host: string; port: number; maxRetriesPerRequest: null };
}

let sharedMemoryServer: RedisMemoryServer | null = null;

async function resolveUrl(): Promise<string> {
  const fromEnv = process.env.REDIS_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (!sharedMemoryServer) sharedMemoryServer = await RedisMemoryServer.create();
  const host = await sharedMemoryServer.getHost();
  const port = await sharedMemoryServer.getPort();
  return `redis://${host}:${port}`;
}

export async function createRedisContext(): Promise<RedisTestContext> {
  const url = await resolveUrl();
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = Number(parsed.port || "6379");
  const connectionOptions = { host, port, maxRetriesPerRequest: null as null };
  const connection = new IORedis(connectionOptions);
  return { connection, url, connectionOptions };
}

export async function destroyRedisContext(ctx: RedisTestContext): Promise<void> {
  await ctx.connection.quit().catch(() => ctx.connection.disconnect());
}

/** Stop the shared in-process Redis, if one was started. Call once at teardown. */
export async function stopSharedMemoryServer(): Promise<void> {
  if (sharedMemoryServer) {
    await sharedMemoryServer.stop();
    sharedMemoryServer = null;
  }
}
