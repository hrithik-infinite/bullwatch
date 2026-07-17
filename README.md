# bullwatch

A deep, fast, **local-first** dashboard and observability tool for [BullMQ](https://bullmq.io).

Inspect and operate your queues with the depth of a commercial tool, on infrastructure you control — no account, no telemetry, no external calls. Job payloads are read live from Redis, rendered, and forgotten: **nothing sensitive is ever written to disk**.

## Why

The dominant OSS option ([bull-board](https://github.com/felixmosh/bull-board)) is shallow by design — its maintainer declines to read Redis directly, so the most-requested features (job search, metrics history) have gone unbuilt for years. The commercial option ([Taskforce.sh](https://taskforce.sh)) is deep, but proxies your job payloads through its cloud. bullwatch is the intersection: **deep and local**.

## What makes it different

- **Live payload search** — read-through, budgeted, never indexed. The #1 unbuilt ask in the ecosystem.
- **Real metrics** — throughput, failure rates, and wait/run **latency percentiles**, per queue and per job name. Live with zero config; opt in to Redis-backed rollups for long retention.
- **Worker visibility, flows/DAG, DLQ analysis, replay** — the operational depth other OSS tools lack.
- **Payload masking** — redact sensitive fields (`user.ssn`, `**.token`) at render, and honored in search so a masked field can't be probed out.
- **Provably local** — zero external network calls, enforced in CI. Works air-gapped. Payloads never persisted, enforced structurally.

## Status

**Beta.** The P0 + P1 backends **and the full web UI** are complete and test-driven (190 tests, real-Redis integration). Published to npm under the `beta` tag while the API settles.

**[▶ Try the live demo](https://hrithik-infinite.github.io/bullwatch/)** — the entire dashboard running in your browser on simulated data, no install required.

- Queue registry with SCAN-based discovery; counts, listing (payload-light
  option), job detail, schedulers, workers, and parent-child flow trees.
- Job actions — retry / promote / remove / clean, pause / resume, and bulk
  retry / remove — all behind a read-only guard, plus optional HTTP Basic auth.
- Live metrics pipeline: tails `QueueEvents`, derives wait/run latency, and
  aggregates counters + latency histograms per queue and per job name
  (percentiles included). In-memory by default; opt-in Redis rollups for
  long retention.
- Budgeted read-through payload search (never indexed; cost surfaced honestly).
- Config-driven payload masking (dotted paths) — applied at render and before
  search matching, so masked fields can't be extracted via search.
- DLQ failure analysis: top error signatures ranked, with per-window trends and
  representative failed-job samples; Prometheus scrape endpoint.
- Replay a failed job with an edited payload (original kept for audit).
- Deploy markers to overlay on charts, and threshold alerts (failure rate,
  queue depth, latency) delivered to your own webhooks — Slack, Discord,
  PagerDuty — with nothing routed through a third party.
- Framework-agnostic HTTP `fetch` handler with **Express, Fastify, and Hono**
  adapters, plus a standalone **`npx bullwatch`** CLI and Docker image.

## Quick start

> Beta packages are published under the `beta` dist-tag — use `@beta` when installing.

### Standalone — no code

```sh
REDIS_URL=redis://localhost:6379 npx bullwatch@beta
# dashboard on http://localhost:3000
```

Configure via env: `BULLWATCH_QUEUES`, `BULLWATCH_READONLY`, `BULLWATCH_MASK`
(comma-separated dotted paths to redact), `BULLWATCH_ALERTS` (JSON rules),
`BULLWATCH_AUTH_USERNAME`/`PASSWORD`. Or build the Docker image from
`packages/standalone/Dockerfile`.

### Embed in your app

Mount the dashboard on any route of an existing server:

```ts
// Express
import express from "express";
import { bullwatchExpress } from "bullwatch-express";

const app = express();
app.use("/admin/queues", bullwatchExpress({
  connection: { host: "localhost", port: 6379 },
  // queues: ["email", "payments"],  // or omit to auto-discover
  // readOnly: true, mask: ["**.token", "user.ssn"],
}));
```

```ts
// Fastify
import { bullwatchFastify } from "bullwatch-fastify";
app.register(bullwatchFastify({ connection }), { prefix: "/admin/queues" });
```

```ts
// Hono
import { bullwatchHono } from "bullwatch-hono";
app.route("/admin/queues", bullwatchHono({ connection }));
```

All adapters take the same [`BullwatchOptions`](packages/core/src/server/app.ts)
(`connection`, `prefix`, `queues`, `readOnly`, `collectMetrics`, `mask`, `auth`, …).

## Development

```sh
pnpm install
pnpm test        # unit + integration; integration uses redis-memory-server,
                 # or set REDIS_URL to point at your own Redis
pnpm build && pnpm typecheck && pnpm lint && pnpm check:no-network
```

## License

MIT
