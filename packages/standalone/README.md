# bullwatch

Standalone server for **[bullwatch](https://github.com/hrithik-infinite/bullwatch)** — a deep, local-first dashboard and observability tool for [BullMQ](https://bullmq.io). Run it with no code.

**[▶ Live demo](https://hrithik-infinite.github.io/bullwatch/)** · payloads read live from Redis and never written to disk · zero external network calls.

```sh
REDIS_URL=redis://localhost:6379 npx bullwatch@beta
# dashboard on http://localhost:3000
```

## Configuration (env)

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection |
| `PORT` | `3000` | HTTP port |
| `BULLWATCH_PREFIX` | `bull` | BullMQ key prefix |
| `BULLWATCH_QUEUES` | (auto-discover) | Comma-separated queue names |
| `BULLWATCH_READONLY` | `false` | Disable all mutating actions (403) |
| `BULLWATCH_MASK` | — | Comma-separated dotted paths to redact, e.g. `password,user.ssn,**.token` |
| `BULLWATCH_ALERTS` | — | JSON alert rules (failure rate / queue depth / latency) |
| `BULLWATCH_AUTH_USERNAME` / `BULLWATCH_AUTH_PASSWORD` | — | Optional HTTP Basic auth |
| `BULLWATCH_PERSIST_METRICS` | `false` | Persist metric rollups to Redis instead of memory |
| `BULLWATCH_COLLECT_METRICS` | `true` | Collect live metrics |
| `BULLWATCH_METRICS_RESCAN_MS` | `30000` | Interval to pick up queues created after startup |

## Docker

Build from the repo (context is the repo root):

```sh
docker build -f packages/standalone/Dockerfile -t bullwatch .
docker run -p 3000:3000 -e REDIS_URL=redis://host.docker.internal:6379 bullwatch
```

To embed the dashboard inside an existing app instead, use
[`@bullwatch/express`](https://www.npmjs.com/package/@bullwatch/express),
[`@bullwatch/fastify`](https://www.npmjs.com/package/@bullwatch/fastify), or
[`@bullwatch/hono`](https://www.npmjs.com/package/@bullwatch/hono).

## License

MIT
