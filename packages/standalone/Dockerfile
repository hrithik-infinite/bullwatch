# Build context is the repo root: docker build -f packages/standalone/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
# redis-memory-server is test-only; skip its binary download during the image build.
ENV REDISMS_DISABLE_POSTINSTALL=1
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
# Drop dev dependencies from the image we ship.
RUN pnpm -r --prod prune 2>/dev/null || pnpm prune --prod 2>/dev/null || true

FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY --from=build /app .
ENV PORT=3000
EXPOSE 3000
# Config via env: REDIS_URL, BULLWATCH_PREFIX, BULLWATCH_QUEUES, BULLWATCH_DISCOVER,
# BULLWATCH_READONLY, BULLWATCH_AUTH_USERNAME/PASSWORD, BULLWATCH_PERSIST_METRICS,
# BULLWATCH_METRICS_REDIS, BULLWATCH_MASK (comma-separated dotted paths to redact,
# e.g. "password,user.ssn,**.token"), BULLWATCH_ALERTS (JSON alert rules),
# BULLWATCH_COLLECT_METRICS (default true), BULLWATCH_METRICS_RESCAN_MS (default 30000).
CMD ["node", "packages/standalone/dist/cli.js"]
