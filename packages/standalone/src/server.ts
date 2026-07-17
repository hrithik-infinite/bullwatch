import { type IncomingMessage, type Server, createServer } from "node:http";
import {
  type BullwatchApp,
  MemoryMetricsStore,
  RedisMetricsStore,
  createBullwatch,
} from "bullwatch-core";
import type { StandaloneConfig } from "./config.js";

/** Build the bullwatch app from standalone config, choosing the metrics tier. */
export function buildApp(config: StandaloneConfig): BullwatchApp {
  const metricsStore = config.persistMetrics
    ? new RedisMetricsStore({ connection: config.metricsConnection ?? config.connection })
    : new MemoryMetricsStore();

  return createBullwatch({
    connection: config.connection,
    prefix: config.prefix,
    queues: config.queues,
    discover: config.discover,
    readOnly: config.readOnly,
    auth: config.auth,
    mask: config.mask,
    alerts: config.alerts,
    // Auto-start live metrics collection at construction for queues known now;
    // the CLI adds a periodic rescan to pick up queues created later.
    collectMetrics: config.collectMetrics,
    metricsStore,
  });
}

/** A minimal Node http server that forwards to the app's fetch handler. */
export function createNodeServer(app: BullwatchApp): Server {
  return createServer(async (req, res) => {
    try {
      const response = await app.fetch(await toWebRequest(req));
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.statusCode = 500;
      res.end('{"error":"internal error"}');
    }
  });
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = `http://localhost${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }

  const method = (req.method ?? "GET").toUpperCase();
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  }

  return new Request(url, { method, headers, body });
}
