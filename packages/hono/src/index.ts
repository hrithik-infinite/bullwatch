import { type BullwatchApp, type BullwatchOptions, createBullwatch } from "bullwatch-core";
import { Hono } from "hono";

export type { BullwatchOptions } from "bullwatch-core";

/**
 * Return a Hono app serving the bullwatch dashboard. Mount it into your own
 * Hono app under any path:
 *
 *   app.route("/admin/queues", bullwatchHono({ queues: [emailQueue] }));
 *
 * When mounted, Hono routes the sub-app on the path relative to the mount, so
 * the core handler sees /api/... regardless of the mount point.
 */
export function bullwatchHono(options: BullwatchOptions): Hono {
  const app: BullwatchApp = createBullwatch(options);
  const router = new Hono();

  // A named catch-all param yields the path relative to the mount point (Hono
  // strips the route()/basePath prefix from it), so the core handler always
  // sees /api/... regardless of where the sub-app is mounted.
  router.all("/:rest{.*}", (c) => {
    const rest = c.req.param("rest") ?? "";
    const search = new URL(c.req.url).search;
    const url = `http://bullwatch.local/${rest}${search}`;
    return app.fetch(new Request(url, c.req.raw));
  });

  return router;
}
