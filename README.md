# bullwatch

A deep, fast, **local-first** dashboard and observability tool for [BullMQ](https://bullmq.io).

Inspect and operate your queues with the depth of a commercial tool, on infrastructure you control — no account, no telemetry, no external calls. Job payloads are read live from Redis, rendered, and forgotten: **nothing sensitive is ever written to disk**.

## Why

The dominant OSS option ([bull-board](https://github.com/felixmosh/bull-board)) is shallow by design — its maintainer declines to read Redis directly, so the most-requested features (job search, metrics history) have gone unbuilt for years. The commercial option ([Taskforce.sh](https://taskforce.sh)) is deep, but proxies your job payloads through its cloud. bullwatch is the intersection: **deep and local**.

## What makes it different

- **Live payload search** — read-through, budgeted, never indexed. The #1 unbuilt ask in the ecosystem.
- **Real metrics** — throughput, failure rates, and wait/run **latency percentiles**, per queue and per job name. Live with zero config; opt in to Redis-backed rollups for long retention.
- **Worker visibility, flows/DAG, DLQ analysis, replay** — the operational depth other OSS tools lack.
- **Provably local** — zero external network calls, enforced in CI. Works air-gapped. Payloads never persisted, enforced structurally.

## Status

Early development — backend core in progress, UI not started.

Working today (`@bullwatch/core`, test-driven, 66 tests):

- Queue registry with SCAN-based discovery; job counts, listing, and detail.
- Job actions (retry / promote / remove / clean) with a read-only guard.
- Live metrics pipeline: tails `QueueEvents`, derives wait/run latency, and
  aggregates counters + latency histograms per queue and per job name into a
  bounded in-memory store (percentiles included).
- Budgeted read-through payload search (never indexed; cost surfaced honestly).
- DLQ grouping by normalized error signature.
- HTTP API (framework-agnostic `fetch` handler) + one-line Express adapter.

## Development

```sh
pnpm install
pnpm test        # unit + integration; integration uses redis-memory-server,
                 # or set REDIS_URL to point at your own Redis
pnpm build && pnpm typecheck && pnpm lint && pnpm check:no-network
```

## License

MIT
