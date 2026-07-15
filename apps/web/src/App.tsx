import { useEffect, useState } from "react";
import { api } from "./api/client.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { Header } from "./components/Header.js";
import { JobDrawer } from "./components/JobDrawer.js";
import { Sidebar } from "./components/Sidebar.js";
import { mono } from "./components/primitives.js";
import { usePoll } from "./hooks/usePoll.js";
import { useToast } from "./lib/drawer.js";
import { useRoute } from "./lib/router.js";
import { Alerts } from "./screens/Alerts.js";
import { Dlq } from "./screens/Dlq.js";
import { Flows } from "./screens/Flows.js";
import { Metrics } from "./screens/Metrics.js";
import { Overview } from "./screens/Overview.js";
import { QueueDetail } from "./screens/QueueDetail.js";
import { Search } from "./screens/Search.js";
import { Workers } from "./screens/Workers.js";
import { Placeholder } from "./screens/shared.js";

function Toast() {
  const msg = useToast();
  if (!msg) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 22,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 70,
        background: "var(--bg-2)",
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
        padding: "10px 16px",
        boxShadow: "var(--shadow-lg)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        animation: "bw-pop .16s ease",
      }}
    >
      <span
        style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--st-completed)" }}
      />
      <span style={mono({ fontSize: 12.5, color: "var(--text-0)" })}>{msg}</span>
    </div>
  );
}
import { AppProvider } from "./state.js";

const CRUMB: Record<string, string> = {
  overview: "Overview",
  queue: "Overview",
  workers: "Workers",
  flows: "Flows",
  search: "Search",
  metrics: "Metrics",
  dlq: "Dead-letter",
  alerts: "Alerts",
  system: "Design system",
};

function Shell() {
  const route = useRoute();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const health = usePoll((s) => api.health(s), [], 15_000);
  const queuesQ = usePoll((s) => api.queues(s), [], 4_000);
  const alertsQ = usePoll((s) => api.alerts(s).catch(() => ({ alerts: [] })), [], 8_000);

  const queues = queuesQ.data?.queues ?? null;
  const jobsTotal = queues ? queues.reduce((a, q) => a + q.total, 0) : null;
  const dlqTotal = queues ? queues.reduce((a, q) => a + (q.counts.failed ?? 0), 0) : null;
  const alertsFiring = (alertsQ.data?.alerts ?? []).some((a) => a.status === "firing");
  const conn = health.data
    ? `${health.data.metricsStore} store · ${health.data.readOnly ? "read-only" : "read-write"}`
    : "connecting…";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const crumbLeaf = route.name === "queue" ? route.queue : undefined;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        background: "var(--bg)",
        color: "var(--text-0)",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        overflow: "hidden",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <Sidebar
        conn={conn}
        connOk={!!health.data && !health.error}
        jobsTotal={jobsTotal}
        dlqTotal={dlqTotal}
        workersLabel={null}
        alertsFiring={alertsFiring}
      />
      <main
        style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
      >
        <Header
          crumbRoot={CRUMB[route.name] ?? "bullwatch"}
          crumbLeaf={crumbLeaf}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <div style={{ flex: 1, overflow: "auto", minHeight: 0, minWidth: 0 }}>
          {route.name === "overview" && (
            <Overview queues={queues} loading={queuesQ.loading} error={queuesQ.error} />
          )}
          {route.name === "queue" && <QueueDetail queue={route.queue} />}
          {route.name === "search" && <Search queues={queues} />}
          {route.name === "workers" && <Workers queues={queues} />}
          {route.name === "flows" && <Flows queues={queues} />}
          {route.name === "metrics" && <Metrics queues={queues} />}
          {route.name === "dlq" && <Dlq queues={queues} />}
          {route.name === "alerts" && <Alerts />}
          {route.name === "system" && (
            <Placeholder
              label="Design system"
              note="Component gallery — design tokens live in styles.css and components/primitives.tsx."
            />
          )}
        </div>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} queues={queues} />
      <JobDrawer />
      <Toast />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
