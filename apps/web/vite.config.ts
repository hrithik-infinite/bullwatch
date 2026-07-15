import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dashboard is a static SPA served by the bullwatch server under its own
// mount. In dev, proxy the API + Prometheus routes to a running backend
// (BULLWATCH_API, default the standalone's port). No external calls.
const API = process.env.BULLWATCH_API ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  // Relative base so the built assets work under any mount path.
  base: "./",
  server: {
    port: 5273,
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/metrics": { target: API, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
