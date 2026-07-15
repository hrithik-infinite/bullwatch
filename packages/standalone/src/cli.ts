import { configFromEnv } from "./config.js";
import { buildApp, createNodeServer } from "./server.js";

const config = configFromEnv(process.env);
const app = buildApp(config);
const server = createNodeServer(app);

server.listen(config.port, () => {
  const mode = config.readOnly ? "read-only" : "read-write";
  const metrics = config.persistMetrics ? "redis" : "memory";
  console.log(
    `bullwatch listening on http://localhost:${config.port} ` +
      `(prefix=${config.prefix}, ${mode}, metrics=${metrics}, auth=${config.auth ? "on" : "off"})`,
  );
});

// Start live metrics collection (idempotent).
app.startMetrics().catch((err) => console.error("failed to start metrics collection:", err));

async function shutdown(): Promise<void> {
  server.close();
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
