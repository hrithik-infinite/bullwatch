import { useMemo, useState } from "react";
import { api } from "../api/client.js";
import type { JobDTO, MetricKind } from "../api/types.js";
import { Card, Meter, Pill, Sparkline, mono } from "../components/primitives.js";
import { usePoll } from "../hooks/usePoll.js";
import { drawer } from "../lib/drawer.js";
import {
  STATE_COLOR,
  counterBuckets,
  fmt,
  fmtAge,
  fmtDur,
  mergeHistogram,
  percentile,
  sumCounters,
} from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { Screen } from "./shared.js";

const STATE_ORDER = [
  "waiting",
  "active",
  "completed",
  "failed",
  "delayed",
  "paused",
  "prioritized",
];
const WINDOW_MS = 60 * 60 * 1000;

function LatencyCard({
  label,
  metric,
  queue,
  color,
}: {
  label: string;
  metric: MetricKind;
  queue: string;
  color: string;
}) {
  const now = Date.now();
  const { data } = usePoll(
    (s) => api.metrics(queue, { metric, from: now - WINDOW_MS, to: now }, s),
    [queue, metric],
    5_000,
  );
  const hist = useMemo(() => mergeHistogram(data?.series ?? []), [data]);
  const p = (q: number) =>
    hist.kind === "histogram" && hist.totalCount > 0 ? fmtDur(percentile(hist, q)) : "—";
  const has = hist.kind === "histogram" && hist.totalCount > 0;

  return (
    <Card
      style={{
        padding: "13px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", color: "var(--text-2)" }}
        >
          {label}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={mono({ fontSize: 18, fontWeight: 640, color: has ? undefined : "var(--text-3)" })}
        >
          {p(0.95)}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>p95</span>
      </div>
      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-2)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 2, background: color }} />
          p50 <span style={mono({ color: "var(--text-1)" })}>{p(0.5)}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 2, background: "var(--st-failed)" }} />
          p99 <span style={mono({ color: "var(--text-1)" })}>{p(0.99)}</span>
        </span>
      </div>
      {!has && (
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
          no latency samples in the last hour
        </span>
      )}
    </Card>
  );
}

function ThroughputCard({ queue }: { queue: string }) {
  const now = Date.now();
  const { data } = usePoll(
    (s) => api.metrics(queue, { metric: "completed", from: now - WINDOW_MS, to: now }, s),
    [queue],
    5_000,
  );
  const series = data?.series ?? [];
  const buckets = useMemo(() => counterBuckets(series, now - WINDOW_MS, now, 40), [series, now]);
  const perMin = sumCounters(series) / 60;
  const has = sumCounters(series) > 0;

  return (
    <Card
      style={{
        padding: "13px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", color: "var(--text-2)" }}
        >
          THROUGHPUT
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={mono({ fontSize: 18, fontWeight: 640, color: has ? undefined : "var(--text-3)" })}
        >
          {has ? perMin.toFixed(perMin < 10 ? 1 : 0) : "—"}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>/min</span>
      </div>
      <Sparkline values={buckets} width={280} height={44} color="var(--accent)" />
      {!has && (
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
          no completions in the last hour
        </span>
      )}
    </Card>
  );
}

export function QueueDetail({ queue }: { queue: string }) {
  const summaryQ = usePoll((s) => api.queue(queue, s), [queue], 4_000);
  const summary = summaryQ.data;
  const counts = summary?.counts ?? {};
  const states = STATE_ORDER.filter(
    (st) => (counts[st] ?? 0) > 0 || st === "waiting" || st === "failed",
  );
  const [tab, setTab] = useState<string>((counts.failed ?? 0) > 0 ? "failed" : "waiting");

  const jobsQ = usePoll(
    (s) => api.jobs(queue, { state: tab, start: 0, end: 49, includeData: false }, s),
    [queue, tab],
    4_000,
  );
  const jobs: JobDTO[] = jobsQ.data?.jobs ?? [];

  const busy = summaryQ.loading && !summary;

  return (
    <Screen label="Queue detail">
      <div
        style={{
          padding: "18px 18px 6px",
          display: "flex",
          alignItems: "center",
          gap: 13,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          data-bw-ghost=""
          onClick={() => navigate({ name: "overview" })}
          style={{
            width: 28,
            height: 28,
            flex: "none",
            display: "grid",
            placeItems: "center",
            border: "1px solid var(--border)",
            background: "transparent",
            borderRadius: 8,
            color: "var(--text-2)",
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          ‹
        </button>
        <h1 style={mono({ margin: 0, fontSize: 18, fontWeight: 660, letterSpacing: "-.01em" })}>
          {queue}
        </h1>
        {summary?.paused && <Pill color="var(--st-paused)">PAUSED</Pill>}
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          {busy ? "loading…" : `${fmt(summary?.total ?? 0)} jobs`}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            data-bw-ghost=""
            onClick={async () => {
              try {
                await (summary?.paused ? api.resume(queue) : api.pause(queue));
                summaryQ.refetch();
              } catch (e) {
                alert(e instanceof Error ? e.message : String(e));
              }
            }}
            style={{
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              font: "inherit",
              fontSize: 12,
              padding: "5px 11px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            {summary?.paused ? "Resume queue" : "Pause queue"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: 12,
          padding: "12px 18px 4px",
        }}
      >
        <ThroughputCard queue={queue} />
        <LatencyCard label="WAIT LATENCY" metric="wait_ms" queue={queue} color="var(--st-active)" />
        <LatencyCard
          label="RUN LATENCY"
          metric="run_ms"
          queue={queue}
          color="var(--st-completed)"
        />
      </div>

      <Card style={{ margin: "12px 18px 22px", overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
            padding: "0 6px",
            overflow: "auto",
          }}
        >
          {states.map((st) => {
            const cur = st === tab;
            return (
              <button
                key={st}
                type="button"
                data-bw-tab=""
                aria-current={cur ? "page" : undefined}
                onClick={() => setTab(st)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "10px 13px 11px",
                  border: 0,
                  background: "transparent",
                  font: "inherit",
                  fontSize: 12.5,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: STATE_COLOR[st] ?? "var(--text-3)",
                  }}
                />
                <span style={{ textTransform: "capitalize" }}>{st}</span>
                <span style={mono({ fontSize: 11, color: "var(--text-3)" })}>
                  {fmt(counts[st] ?? 0)}
                </span>
                {cur && (
                  <span
                    style={{
                      position: "absolute",
                      left: 8,
                      right: 8,
                      bottom: -1,
                      height: 2,
                      borderRadius: 2,
                      background: "var(--accent)",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 430px)", minHeight: 220 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-row)" }}>
            <tbody>
              {jobs.map((j) => (
                <tr
                  key={j.id ?? Math.random()}
                  data-bw-row=""
                  onClick={() => j.id && drawer.open(queue, j.id)}
                  style={{ borderBottom: "1px solid var(--border-faint)", cursor: "pointer" }}
                >
                  <td style={{ padding: "var(--cell-py) var(--cell-px)", width: "10%" }}>
                    <span style={mono({ fontSize: 12, color: "var(--accent)" })}>#{j.id}</span>
                  </td>
                  <td style={{ padding: "var(--cell-py) var(--cell-px)", width: "18%" }}>
                    <span style={mono({ fontSize: 12.5, color: "var(--text-0)" })}>{j.name}</span>
                  </td>
                  <td style={{ padding: "var(--cell-py) var(--cell-px)" }}>
                    {j.errorSignature ? (
                      <span style={mono({ fontSize: 11.5, color: "var(--st-failed)" })}>
                        {j.errorSignature}
                      </span>
                    ) : (
                      <span style={mono({ fontSize: 11.5, color: "var(--text-3)" })}>
                        attempt {j.attemptsMade}
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      padding: "var(--cell-py) var(--cell-px)",
                      textAlign: "right",
                      width: "9%",
                    }}
                  >
                    <span style={mono({ fontSize: 11.5, color: "var(--text-2)" })}>
                      {fmtDur(j.timings.runMs)}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "var(--cell-py) var(--cell-px)",
                      textAlign: "right",
                      width: "7%",
                    }}
                  >
                    <span style={mono({ fontSize: 11.5, color: "var(--text-3)" })}>
                      {fmtAge(j.finishedOn ?? j.processedOn ?? j.timestamp)}
                    </span>
                  </td>
                  {tab === "failed" && (
                    <td
                      style={{
                        padding: "var(--cell-py) var(--cell-px)",
                        textAlign: "right",
                        width: "8%",
                      }}
                    >
                      <button
                        type="button"
                        data-bw-ghost=""
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!j.id) return;
                          try {
                            await api.retry(queue, j.id);
                            jobsQ.refetch();
                            summaryQ.refetch();
                          } catch (err) {
                            alert(err instanceof Error ? err.message : String(err));
                          }
                        }}
                        style={{
                          border: "1px solid var(--border)",
                          background: "transparent",
                          color: "var(--text-1)",
                          font: "inherit",
                          fontSize: 11,
                          padding: "2px 9px",
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                      >
                        Retry
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {jobs.length === 0 && !jobsQ.loading && (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      padding: "28px 14px",
                      textAlign: "center",
                      color: "var(--text-2)",
                      fontSize: 12.5,
                    }}
                  >
                    No <span style={mono()}>{tab}</span> jobs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Screen>
  );
}
