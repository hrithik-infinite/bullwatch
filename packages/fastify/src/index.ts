import { type BullwatchApp, type BullwatchOptions, createBullwatch } from "@bullwatch/core";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

export type { BullwatchOptions } from "@bullwatch/core";

/**
 * Fastify plugin that serves the bullwatch dashboard. Register it under any
 * prefix:
 *
 *   app.register(bullwatchFastify({ queues: [emailQueue] }), {
 *     prefix: "/admin/queues",
 *   });
 *
 * A thin shell: it forwards every request to the one framework-agnostic fetch
 * handler in @bullwatch/core and streams the response back.
 */
export function bullwatchFastify(options: BullwatchOptions): FastifyPluginAsync {
  const app: BullwatchApp = createBullwatch(options);

  const plugin: FastifyPluginAsync = async (fastify) => {
    fastify.all("/*", async (req, reply) => {
      const response = await app.fetch(toWebRequest(req));
      reply.code(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(Buffer.from(await response.arrayBuffer()));
    });
  };

  return plugin;
}

function toWebRequest(req: FastifyRequest): Request {
  // The wildcard param is the path after the plugin prefix, so the core handler
  // sees /api/... regardless of the mount point.
  const star = (req.params as Record<string, string>)["*"] ?? "";
  const qIndex = req.url.indexOf("?");
  const search = qIndex >= 0 ? req.url.slice(qIndex) : "";
  const url = `http://bullwatch.local/${star}${search}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody && req.body !== undefined ? JSON.stringify(req.body) : undefined;

  return new Request(url, { method, headers, body });
}

// Re-exported for callers that annotate their handler types.
export type { FastifyReply, FastifyRequest };
