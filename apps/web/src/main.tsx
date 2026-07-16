import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

async function boot() {
  // Static-demo build (GitHub Pages): patch fetch with an in-memory backend
  // before anything renders, so no real bullwatch server is required. The
  // dynamic import is tree-shaken out of a normal (non-demo) build.
  if (import.meta.env.VITE_DEMO === "1" || import.meta.env.VITE_DEMO === "true") {
    const { installMockFetch } = await import("./demo/mock.js");
    installMockFetch();
  }

  const el = document.getElementById("root");
  if (!el) throw new Error("#root not found");
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
