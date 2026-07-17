# Build context is the repo root: docker build -f packages/standalone/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
# redis-memory-server is test-only; skip its binary download during the image build.
ENV REDISMS_DISABLE_POSTINSTALL=1
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
# Build the standalone server and its workspace dependencies (bullwatch-core).
RUN pnpm --filter bullwatch... build
# Produce a self-contained, production-only deployment of just the standalone
# package: dist + a flat node_modules holding bullwatch-core, bullmq, ioredis —
# and nothing from the other adapters or dev tooling.
RUN pnpm --filter=bullwatch deploy --prod /prod

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Only the pruned deployment ships — no source, no dev deps, no other packages.
COPY --from=build /prod .
EXPOSE 3000
# Config via env: REDIS_URL, BULLWATCH_PREFIX, BULLWATCH_QUEUES, BULLWATCH_DISCOVER,
# BULLWATCH_READONLY, BULLWATCH_AUTH_USERNAME/PASSWORD, BULLWATCH_PERSIST_METRICS,
# BULLWATCH_METRICS_REDIS, BULLWATCH_MASK (comma-separated dotted paths to redact,
# e.g. "password,user.ssn,**.token"), BULLWATCH_ALERTS (JSON alert rules),
# BULLWATCH_COLLECT_METRICS (default true), BULLWATCH_METRICS_RESCAN_MS (default 30000).
CMD ["node", "dist/cli.js"]
