import { type BullwatchApp, type BullwatchOptions, createBullwatch } from "@bullwatch/core";
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from "express";

export type { BullwatchOptions } from "@bullwatch/core";

/**
 * Create an Express handler that serves the bullwatch dashboard. Mount it under
 * any base path:
 *
 *   app.use("/admin/queues", bullwatchExpress({ queues: [emailQueue] }));
 *
 * The adapter is deliberately thin: it converts the incoming Express request to
 * a web-standard Request, hands it to the one framework-agnostic fetch handler
 * in @bullwatch/core, and streams the Response back.
 */
export function bullwatchExpress(options: BullwatchOptions = {}) {
  const app: BullwatchApp = createBullwatch(options);

  return async (req: ExpressRequest, res: ExpressResponse, next: NextFunction): Promise<void> => {
    try {
      const request = toWebRequest(req);
      const response = await app.fetch(request);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      const body = Buffer.from(await response.arrayBuffer());
      res.end(body);
    } catch (err) {
      next(err);
    }
  };
}

function toWebRequest(req: ExpressRequest): Request {
  // Host is irrelevant — the core handler routes on pathname only. Using a
  // fixed local origin keeps this request from ever implying a network target.
  const url = `http://bullwatch.local${req.originalUrl}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  // TODO: stream the body instead of buffering once mutating routes exist and
  // an express body parser is standardized across adapters.
  const body = hasBody && req.body !== undefined ? JSON.stringify(req.body) : undefined;

  return new Request(url, { method, headers, body });
}
