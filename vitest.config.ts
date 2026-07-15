import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests boot a real Redis (Docker via REDIS_URL, or an
    // in-process redis-memory-server binary on first run) — allow for it.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    include: ["packages/*/src/**/*.test.ts"],
    // Integration test files share one Redis and flushall between tests; running
    // files in parallel would let them clobber each other. Serialize files.
    fileParallelism: false,
  },
});
