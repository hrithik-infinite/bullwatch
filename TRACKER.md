# bullwatch — progress tracker

Last updated: 2026-07-15 · 80 tests passing · core backend in progress, UI not started.

A deep, local-first BullMQ dashboard. This file tracks build status against the
product plan. The full research/plan and UI design brief live in `docs/`
(gitignored, kept local).

**Legend:** ✅ done · 🟡 partial · ⬜ not started · 🎨 needs UI

---

## Milestones

- [x] Product research + plan (`docs/research/bullmq-dashboard-plan.md`)
- [x] Competitor deep dive (Workbench audit) — plan §3.4a
- [x] Name chosen: **bullwatch** (npm/org/domain verified free — not yet claimed)
- [x] Private repo + gitignore (docs excluded)
- [x] Monorepo scaffold (pnpm, TS strict, Biome, Vitest, tsup, CI)
- [x] Structural privacy invariant (typed `MetricsStore` boundary + CI gates)
- [x] Backend wave 1 — reads, actions, search, live metrics
- [x] Backend wave 2 — workers, flows, Redis rollups, Prometheus, auto-collect
- [ ] UI design (in progress, external)
- [ ] Standalone distribution (Docker + CLI)
- [ ] First public release

---

## P0 — table stakes (replace bull-board)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| P0.1 | Queue/job browser (states, pagination, detail) | 🟡 🎨 | Backend: `getQueueSummary`, `listJobs`, `getJobDetail` + routes. UI pending. |
| P0.2 | Job actions (retry/promote/remove/clean, bulk) | 🟡 | `retry`+`remove` have routes; `promote`+`clean` implemented, routes pending; bulk endpoints pending. Read-only guard ✅. |
| P0.3 | Large-payload sane defaults (truncate, click-to-load) | ⬜ 🎨 | Needs `excludeData` list option + UI lazy-load. |
| P0.4 | Schedulers & repeatables | ⬜ | No reader/route yet (`getJobSchedulers`). |
| P0.5 | Pause/resume + overview | 🟡 | `isPaused` read ✅ via summary; pause/resume mutation routes pending. Overview = `/api/queues`. |
| P0.6 | Adapters: Express, Fastify, NestJS, Hono | 🟡 | Express ✅. Fastify/NestJS/Hono pending (thin wrappers over the one fetch handler). |
| P0.7 | Standalone: Docker image + `npx bullwatch` | 🟡 | Queue SCAN discovery ✅. Docker/CLI shell pending. |
| P0.8 | Read-only mode + auth hooks | 🟡 | `readOnly` ✅ (403 on mutate). Basic-auth / bring-your-own-auth pending. |
| P0.9 | Live metrics (in-memory tier b) | ✅ 🎨 | Collector → latency histograms + counters, per queue & job name, percentiles. Charts UI pending. |
| P0.10 | Zero-external-calls build + CI gate | ✅ | `check:no-network` scans shipped bundles; runs in CI. |

## P1 — differentiators

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| P1.1 | Live payload search (budgeted read-through) | ✅ 🎨 | `searchJobs` + `/search`; honest `scanned`/`truncated`. UI pending. |
| P1.2 | Persistent rollups (Redis tier c) | ✅ | `RedisMetricsStore` — own prefix, TTL retention, atomic merges. |
| P1.3 | Worker visibility | ✅ 🎨 | `getWorkers` + `/workers`. |
| P1.4 | Flows / DAG view | ✅ 🎨 | `getFlowTree` + `/flows/:id`. |
| P1.5 | DLQ / failure analysis (error-signature grouping) | 🟡 🎨 | Grouping + per-signature queries ✅. Dedicated DLQ endpoint (top signatures + trend) pending. |
| P1.6 | Replay with overridden input | ⬜ | Re-add failed job with edited payload. |
| P1.7 | Prometheus endpoint | ✅ | `GET /metrics` (job counts + paused gauges). |
| P1.8 | Webhooks + Slack alerts | ⬜ | Threshold rules → user-controlled URLs. |
| P1.9 | Deploy markers | ⬜ | Stamp deploy lines on charts (needs tier c). |
| P1.10 | Payload masking / field redaction | ⬜ 🎨 | Config-driven mask at render + honored in search results. |

## P2 — later

| Feature | Status |
|---------|--------|
| Multi-Redis / multi-env single pane | ⬜ |
| RBAC roles (viewer/operator/admin) + audit log | ⬜ |
| OTel export + prebuilt Grafana dashboards | ⬜ |
| "Prove it" mode (network manifest, SBOM, reproducible builds) | ⬜ |
| Saved filter views, job tagging/silencing | ⬜ |
| TUI companion / MCP server | ⬜ |
| BullMQ Pro (groups/batches) support | ⬜ |

---

## Backend module inventory (`@bullwatch/core`)

- **Domain (pure, unit-tested):** `timings`, `error-signature`, `search-query`, `discovery`, `events`.
- **Storage:** `aggregate` (typed persistence boundary), `labels` (invariant enforcement), `metrics-store` (interface), `histogram` (+ percentiles), `memory-store` (tier b), `redis-store` (tier c).
- **BullMQ:** `registry` (discovery, `queueExists`, `FlowProducer`), `readers` (summary/list/detail/workers), `job-dto`, `actions` (retry/promote/remove/clean + read-only guard), `search`, `flows`, `metrics-collector`.
- **Server:** `app` (HTTP fetch handler + `startMetrics`), `prometheus`.
- **Adapters:** `@bullwatch/express`.
- **Testing/CI:** `redis-harness` (real Redis via `REDIS_URL` or `redis-memory-server`), `check-no-network` gate.

### HTTP routes live today
`GET /api/health` · `GET /api/queues` · `GET /api/queues/:name` ·
`GET /api/queues/:name/jobs` · `GET /api/queues/:name/jobs/:id` ·
`GET /api/queues/:name/search` · `GET /api/queues/:name/metrics` ·
`GET /api/queues/:name/workers` · `GET /api/queues/:name/flows/:id` ·
`GET /metrics` (Prometheus) · `POST /api/queues/:name/jobs/:id/retry` ·
`DELETE /api/queues/:name/jobs/:id`

---

## Next up (suggested order)

1. Route out the built-but-unexposed actions: `promote`, `clean`, pause/resume; add bulk retry/delete.
2. Schedulers/repeatables reader + route (P0.4).
3. Fastify / NestJS / Hono adapters (P0.6).
4. Standalone Docker + `npx bullwatch` CLI (P0.7).
5. Payload masking + `excludeData`/truncation defaults (P0.3, P1.10) — privacy surface.
6. Dedicated DLQ endpoint (P1.5) and replay-with-edits (P1.6).
7. UI integration once the design lands.

## Open decisions

- [ ] Move repo to `bullwatch` GitHub org (cleaner `@bullwatch/*` scope) vs keep on personal account.
- [ ] Claim npm name `bullwatch`, GitHub org, `bullwatch.dev` domain.
- [ ] SSE vs websocket for live UI updates (plan open-question #6).
- [ ] Managed-Redis `CLIENT LIST` compatibility matrix for worker visibility.
