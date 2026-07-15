import { api } from "../api/client.js";
import type { QueueSummary } from "../api/types.js";
import { Card, mono } from "../components/primitives.js";
import { usePoll } from "../hooks/usePoll.js";
import { ErrorBar, Screen } from "./shared.js";

interface AggWorker {
  key: string;
  addr: string | null;
  name: string | null;
  ageSeconds: number | null;
  idleSeconds: number | null;
  queues: Set<string>;
}

function fmtUptime(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export function Workers({ queues }: { queues: QueueSummary[] | null }) {
  const names = (queues ?? []).map((q) => q.name);

  const { data, error, loading } = usePoll(
    async (signal) => {
      const per = await Promise.all(
        names.map((name) =>
          api
            .workers(name, signal)
            .then((r) => ({ name, workers: r.workers }))
            .catch(() => ({ name, workers: [] })),
        ),
      );
      const map = new Map<string, AggWorker>();
      for (const { name, workers } of per) {
        for (const w of workers) {
          const key = w.addr ?? w.id ?? Math.random().toString();
          let agg = map.get(key);
          if (!agg) {
            agg = {
              key,
              addr: w.addr,
              name: w.name,
              ageSeconds: w.ageSeconds,
              idleSeconds: w.idleSeconds,
              queues: new Set(),
            };
            map.set(key, agg);
          }
          agg.queues.add(name);
          // Keep the freshest idle reading.
          if (
            w.idleSeconds !== null &&
            (agg.idleSeconds === null || w.idleSeconds < agg.idleSeconds)
          )
            agg.idleSeconds = w.idleSeconds;
        }
      }
      return [...map.values()].sort((a, b) => (a.addr ?? "").localeCompare(b.addr ?? ""));
    },
    [names.join(",")],
    5_000,
  );

  const workers = data ?? [];

  return (
    <Screen label="Workers">
      <div style={{ padding: "18px 18px 44px", maxWidth: 1120 }}>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 660, letterSpacing: "-.01em" }}>
          Workers
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>
          <span
            style={mono({ color: workers.length > 0 ? "var(--st-completed)" : "var(--text-3)" })}
          >
            {workers.length}
          </span>{" "}
          worker connection{workers.length === 1 ? "" : "s"} across {names.length} queues
          {loading && !data ? " · loading…" : ""}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-3)" }}>
          Backed by Redis <span style={mono()}>CLIENT LIST</span> — reports connection presence, not
          in-process concurrency. Some managed Redis providers disable it.
        </p>

        {error && <ErrorBar message={error} />}

        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
            gap: 12,
          }}
        >
          {workers.map((w) => {
            const active = w.idleSeconds !== null && w.idleSeconds < 5;
            const color = active ? "var(--st-active)" : "var(--st-completed)";
            return (
              <Card
                key={w.key}
                style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 11 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: color,
                      flex: "none",
                    }}
                  />
                  <span
                    style={mono({
                      fontSize: 12.5,
                      color: "var(--text-0)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    })}
                  >
                    {w.addr ?? w.name ?? "worker"}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={mono({ fontSize: 11, color: "var(--text-3)" })}>
                    up {fmtUptime(w.ageSeconds)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-2)" }}>
                  listening on{" "}
                  <span style={mono({ color: "var(--text-1)" })}>{[...w.queues].join(", ")}</span>
                </div>
                <div
                  style={{
                    background: "var(--bg-inset)",
                    border: "1px solid var(--border-faint)",
                    borderRadius: 8,
                    padding: "9px 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 11,
                    color: "var(--text-2)",
                  }}
                >
                  {active ? (
                    <>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--st-active)",
                          animation: "bw-pulse 1.6s ease-in-out infinite",
                        }}
                      />
                      processing
                    </>
                  ) : (
                    <span style={{ color: "var(--text-3)" }}>idle {fmtUptime(w.idleSeconds)}</span>
                  )}
                </div>
              </Card>
            );
          })}
          {workers.length === 0 && !loading && (
            <div
              style={{
                gridColumn: "1/-1",
                padding: "40px 18px",
                border: "1px dashed var(--border-strong)",
                borderRadius: 12,
                textAlign: "center",
                color: "var(--text-2)",
                fontSize: 13,
              }}
            >
              No workers connected. Start a BullMQ Worker against one of these queues, or your Redis
              provider may not support CLIENT LIST.
            </div>
          )}
        </div>
      </div>
    </Screen>
  );
}
