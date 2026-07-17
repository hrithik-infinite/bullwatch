# Contributing to bullwatch

Thanks for your interest — bullwatch is in **beta**, and contributions, bug reports, and feature ideas are all welcome.

## Ways to help

- **Report a bug** — open an [issue](https://github.com/hrithik-infinite/bullwatch/issues) with steps to reproduce, your BullMQ/Redis versions, and what you expected.
- **Request a feature** — open an issue describing the use case (the *why*, not just the *what*).
- **Send a pull request** — for anything non-trivial, open an issue first so we can agree on the approach before you invest time.

## Project layout

A pnpm workspace (TypeScript, strict). The web UI is a separate app.

| Path | What it is |
|---|---|
| `packages/core` (`bullwatch-core`) | Readers, actions, search, storage tiers, live-metrics collector, alerts, framework-agnostic `fetch` handler |
| `packages/express` · `fastify` · `hono` | Thin framework adapters over core |
| `packages/standalone` (`bullwatch`) | `npx bullwatch` CLI + Docker server |
| `apps/web` | React + Vite dashboard (talks to the core HTTP API) |

## Development setup

Requires **Node 20+** and **pnpm 9** (via Corepack). Integration tests need a Redis — either Docker, or the bundled `redis-memory-server` which downloads a Redis binary on first run.

```sh
pnpm install

# Run the full check suite (this is exactly what CI runs):
pnpm lint          # Biome
pnpm typecheck     # tsc, strict
pnpm build         # tsup, all packages
pnpm test          # unit + real-Redis integration
pnpm check:no-network

# Point tests at your own Redis instead of redis-memory-server:
REDIS_URL=redis://localhost:6379 pnpm test
```

To work on the UI against a running backend:

```sh
pnpm --filter bullwatch dev            # backend on :3000
pnpm --filter @bullwatch/web dev       # UI on :5273 (proxies /api to :3000)
# or preview the static in-browser demo (no backend):
pnpm --filter @bullwatch/web preview:demo
```

## Non-negotiable invariants

These are what make bullwatch *bullwatch*. A PR that breaks either will be rejected — and CI enforces both:

1. **Payloads are never persisted.** Job data is read live from Redis, rendered, and forgotten. The `MetricsStore` boundary is typed so nothing sensitive can be written to disk. Don't route payloads into any store.
2. **Zero external network calls** in shipped bundles. `pnpm check:no-network` scans the built output; the tool must work air-gapped.

## Code style & quality bar

- **Biome** for lint + format (100-col, double quotes). Run `pnpm format` before committing.
- **TypeScript strict** — no `any` escapes; respect `noUncheckedIndexedAccess`.
- **Tests are required** for behavioral changes. Integration tests use real Redis; keep them deterministic (`flushall` between tests, no cross-test state).
- All five checks (`lint`, `typecheck`, `build`, `test`, `check:no-network`) must pass locally and in CI.

## Pull request guidelines

- **One concern per PR.** Don't mix a feature, a refactor, and a fix.
- Write a clear description: *what* changed and *why* it matters.
- Keep the public API stable where you can; call out breaking changes explicitly (we're pre-1.0, but still).
- Add or update tests and docs alongside the code.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
