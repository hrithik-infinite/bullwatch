import type { RedisOptions } from "ioredis";

export interface StandaloneConfig {
  readonly connection: RedisOptions;
  readonly prefix: string;
  readonly queues: string[];
  readonly discover: boolean;
  readonly readOnly: boolean;
  readonly auth?: { username: string; password: string };
  readonly persistMetrics: boolean;
  readonly metricsConnection?: RedisOptions;
  readonly port: number;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

/** Parse a redis:// or rediss:// URL into ioredis options (blocking-safe). */
export function parseRedisUrl(url: string): RedisOptions {
  const u = new URL(url);
  const db = u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0;
  return {
    host: u.hostname || "127.0.0.1",
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: Number.isFinite(db) ? db : 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
    // Required by BullMQ for blocking clients (QueueEvents/Worker).
    maxRetriesPerRequest: null,
  };
}

function connectionFromEnv(env: NodeJS.ProcessEnv, urlVar: string): RedisOptions {
  const url = env[urlVar];
  if (url) return parseRedisUrl(url);
  return {
    host: env.REDIS_HOST ?? "127.0.0.1",
    port: Number(env.REDIS_PORT ?? "6379"),
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  };
}

/** Build the standalone config from environment variables. Pure. */
export function configFromEnv(env: NodeJS.ProcessEnv): StandaloneConfig {
  const queues = (env.BULLWATCH_QUEUES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const discover =
    env.BULLWATCH_DISCOVER !== undefined
      ? parseBool(env.BULLWATCH_DISCOVER, true)
      : queues.length === 0;

  const auth =
    env.BULLWATCH_AUTH_USERNAME && env.BULLWATCH_AUTH_PASSWORD
      ? { username: env.BULLWATCH_AUTH_USERNAME, password: env.BULLWATCH_AUTH_PASSWORD }
      : undefined;

  const persistMetrics = parseBool(env.BULLWATCH_PERSIST_METRICS, false);

  return {
    connection: connectionFromEnv(env, "REDIS_URL"),
    prefix: env.BULLWATCH_PREFIX ?? "bull",
    queues,
    discover,
    readOnly: parseBool(env.BULLWATCH_READONLY, false),
    auth,
    persistMetrics,
    metricsConnection: env.BULLWATCH_METRICS_REDIS
      ? parseRedisUrl(env.BULLWATCH_METRICS_REDIS)
      : undefined,
    port: Number(env.PORT ?? "3000"),
  };
}
