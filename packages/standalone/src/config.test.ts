import { describe, expect, it } from "vitest";
import { configFromEnv, parseRedisUrl } from "./config.js";

describe("parseRedisUrl", () => {
  it("parses host, port, db, and credentials", () => {
    const opts = parseRedisUrl("redis://user:pass@redis.internal:6380/2");
    expect(opts).toMatchObject({
      host: "redis.internal",
      port: 6380,
      username: "user",
      password: "pass",
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it("enables TLS for rediss://", () => {
    expect(parseRedisUrl("rediss://localhost:6379").tls).toEqual({});
  });
});

describe("configFromEnv", () => {
  it("defaults to discovery with no explicit queues", () => {
    const cfg = configFromEnv({});
    expect(cfg.discover).toBe(true);
    expect(cfg.queues).toEqual([]);
    expect(cfg.prefix).toBe("bull");
    expect(cfg.port).toBe(3000);
    expect(cfg.readOnly).toBe(false);
    expect(cfg.persistMetrics).toBe(false);
    expect(cfg.auth).toBeUndefined();
    expect(cfg.mask).toEqual([]);
    expect(cfg.collectMetrics).toBe(true);
    expect(cfg.metricsRescanMs).toBe(30000);
  });

  it("allows disabling metrics collection and tuning the rescan interval", () => {
    expect(configFromEnv({ BULLWATCH_COLLECT_METRICS: "false" }).collectMetrics).toBe(false);
    expect(configFromEnv({ BULLWATCH_METRICS_RESCAN_MS: "5000" }).metricsRescanMs).toBe(5000);
    expect(configFromEnv({ BULLWATCH_METRICS_RESCAN_MS: "0" }).metricsRescanMs).toBe(0);
  });

  it("parses a comma-separated mask list", () => {
    const cfg = configFromEnv({ BULLWATCH_MASK: "password, user.ssn ,**.token," });
    expect(cfg.mask).toEqual(["password", "user.ssn", "**.token"]);
  });

  it("parses BULLWATCH_ALERTS as a JSON AlertsConfig", () => {
    const cfg = configFromEnv({
      BULLWATCH_ALERTS: JSON.stringify({
        rules: [{ id: "d", queue: "email", type: "queue_depth", threshold: 1000 }],
        webhookUrls: ["http://hooks.internal/x"],
      }),
    });
    expect(cfg.alerts?.rules).toHaveLength(1);
    expect(cfg.alerts?.webhookUrls).toEqual(["http://hooks.internal/x"]);
  });

  it("throws a clear error on invalid BULLWATCH_ALERTS JSON", () => {
    expect(() => configFromEnv({ BULLWATCH_ALERTS: "{not json" })).toThrow(/not valid JSON/);
  });

  it("leaves alerts undefined when unset", () => {
    expect(configFromEnv({}).alerts).toBeUndefined();
  });

  it("uses an explicit queue list and disables discovery by default", () => {
    const cfg = configFromEnv({ BULLWATCH_QUEUES: "email, billing ,," });
    expect(cfg.queues).toEqual(["email", "billing"]);
    expect(cfg.discover).toBe(false);
  });

  it("reads auth, read-only, port, and persistence flags", () => {
    const cfg = configFromEnv({
      BULLWATCH_AUTH_USERNAME: "admin",
      BULLWATCH_AUTH_PASSWORD: "secret",
      BULLWATCH_READONLY: "true",
      BULLWATCH_PERSIST_METRICS: "1",
      PORT: "8080",
    });
    expect(cfg.auth).toEqual({ username: "admin", password: "secret" });
    expect(cfg.readOnly).toBe(true);
    expect(cfg.persistMetrics).toBe(true);
    expect(cfg.port).toBe(8080);
  });
});
