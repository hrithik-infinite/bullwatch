import { configFromEnv } from "./config.js";
import { buildApp, createNodeServer } from "./server.js";

const config = configFromEnv(process.env);
const app = buildApp(config);
const server = createNodeServer(app);

server.listen(config.port, () => {
  const mode = config.readOnly ? "read-only" : "read-write";
  const metrics = config.persistMetrics ? "redis" : "memory";
  const collect = config.collectMetrics ? "on" : "off";
  console.log(
    `bullwatch listening on http://localhost:${config.port} ` +
      `(prefix=${config.prefix}, ${mode}, metrics=${metrics}, collect=${collect}, auth=${config.auth ? "on" : "off"})`,
  );
});

// buildApp auto-starts live metrics collection for queues known at startup.
// startMetrics is idempotent, so re-running it periodically picks up queues
// created after startup without duplicating collectors. QueueEvents can only
// see events going forward — historical activity before startup isn't backfilled.
let rescan: ReturnType<typeof setInterval> | undefined;
if (config.collectMetrics && config.metricsRescanMs > 0) {
  rescan = setInterval(() => {
    app.startMetrics().catch((err) => console.error("metrics rescan failed:", err));
  }, config.metricsRescanMs);
  rescan.unref?.();
}

async function shutdown(): Promise<void> {
  if (rescan) clearInterval(rescan);
  server.close();
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
