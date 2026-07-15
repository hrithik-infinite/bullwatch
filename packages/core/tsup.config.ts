import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // bullmq and ioredis are peer dependencies; never bundle them.
  external: ["bullmq", "ioredis"],
});
