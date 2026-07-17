import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Enable legacy decorators for the @Module/@Inject syntax NestJS uses.
  tsconfig: "tsconfig.json",
  external: ["@nestjs/common", "@nestjs/core", "bullwatch-express", "bullwatch-core"],
});
