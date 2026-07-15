import { useMemo, useState } from "react";
import { api } from "../api/client.js";
import type { AggregateSeries, DeployMarker, QueueSummary } from "../api/types.js";
import { Card, Sparkline, mono } from "../components/primitives.js";
import { usePoll } from "../hooks/usePoll.js";
import {
  counterBuckets,
  fmt,
  fmtDur,
  histogramPercentileBuckets,
  mergeHistogram,
  percentile,
} from "../lib/format.js";
import { ErrorBar, Screen } from "./shared.js";

const RANGES: Array<{ label: string; ms: number }> = [
  { label: "1h", ms: 3_600_000 },
  { label: "6h", ms: 6 * 3_600_000 },
  { label: "24h", ms: 24 * 3_600_000 },
  { label: "7d", ms: 7 * 24 * 3_600_000 },
];
const N = 48;

/** Multi-series line chart with optional deploy markers. */
function Chart({
  series,
  from,
  to,
  markers,
  height = 120,
  fmtY = (v: number) => String(Math.round(v)),
}: {
  series: Array<{ values: number[]; color: string }>;
  from: number;
  to: number;
  markers?: DeployMarker[];
  height?: number;
  fmtY?: (v: number) => string;
}) {
  const width = 1000;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const path = (values: number[]) => {
    if (values.length < 2) return "";
    const step = width / (values.length - 1);
    return values
      .map(
        (v, i) =>
          `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)} ${(height - 4 - (v / max) * (height - 12)).toFixed(1)}`,
      )
      .join(" ");
  };
  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block" }}
      >
        <line
          x1={0}
          y1={height - 4}
          x2={width}
          y2={height - 4}
          stroke="var(--border)"
          strokeWidth={1}
        />
        {series[0] && (
          <path
            d={`${path(series[0].values)} L${width} ${height} L0 ${height} Z`}
            fill={series[0].color}
            opacity={0.1}
          />
        )}
        {series.map((s) => (
          <path
            key={s.color}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {(markers ?? []).map((m) => {
          const x = ((m.ts - from) / Math.max(1, to - from)) * width;
          if (x < 0 || x > width) return null;
          return (
            <line
              key={m.id}
              x1={x}
              y1={0}
              x2={x}
              y2={height - 4}
              stroke="var(--accent-line)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          );
        })}
      </svg>
      {(markers ?? []).map((m) => {
        const leftPct = ((m.ts - from) / Math.max(1, to - from)) * 100;
        if (leftPct < 0 || leftPct > 100) return null;
        return (
          <div
            key={m.id}
            style={{
              position: "absolute",
              top: -4,
              left: `${leftPct}%`,
              transform: "translateX(-50%)",
              fontSize: 9.5,
              ...mono(),
              color: "var(--text-1)",
              background: "var(--bg-2)",
              border: "1px solid var(--border-strong)",
              borderRadius: 4,
              padding: "1px 5px",
              whiteSpace: "nowrap",
            }}
            title={m.label}
          >
            ⚑ {m.version ?? m.label}
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 4,
          fontSize: 10,
          ...mono(),
          color: "var(--text-3)",
        }}
      >
        {fmtY(max)}
      </div>
    </div>
  );
}

export function Metrics({ queues }: { queues: QueueSummary[] | null }) {
  const [rangeIdx, setRangeIdx] = useState(2);
  const range = RANGES[rangeIdx] ?? RANGES[2];
  const names = (queues ?? []).map((q) => q.name);

  const { data, error, loading } = usePoll(
    async (signal) => {
      const now = Date.now();
      const from = now - (range?.ms ?? 0);
      const gather = async (metric: "completed" | "failed" | "wait_ms" | "run_ms") => {
        const per = await Promise.all(
          names.map((n) =>
            api
              .metrics(n, { metric, from, to: now }, signal)
              .then((r) => r.series)
              .catch(() => [] as AggregateSeries[]),
          ),
        );
        return per.flat();
      };
      const [completed, failed, wait, run, deploys] = await Promise.all([
        gather("completed"),
        gather("failed"),
        gather("wait_ms"),
        gather("run_ms"),
        api
          .deploys({ from, to: now }, signal)
          .then((r) => r.markers)
          .catch(() => [] as DeployMarker[]),
      ]);
      return { now, from, completed, failed, wait, run, deploys };
    },
    [names.join(","), rangeIdx],
    8_000,
  );

  const view = useMemo(() => {
    if (!data) return null;
    const { from, now, completed, failed, wait, run } = data;
    const comp = counterBuckets(completed, from, now, N);
    const fail = counterBuckets(failed, from, now, N);
    const rate = comp.map((c, i) => {
      const f = fail[i] ?? 0;
      const t = c + f;
      return t === 0 ? 0 : (f / t) * 100;
    });
    return {
      comp,
      fail,
      rate,
      waitP95: histogramPercentileBuckets(wait, from, now, N, 0.95),
      runP95: histogramPercentileBuckets(run, from, now, N, 0.95),
      waitHist: mergeHistogram(wait),
      runHist: mergeHistogram(run),
    };
  }, [data]);

  const hasData = view && (view.comp.some((v) => v > 0) || view.fail.some((v) => v > 0));

  return (
    <Screen label="Metrics">
      <div style={{ padding: "18px 18px 44px", maxWidth: 1120 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 660, letterSpacing: "-.01em" }}>
              Metrics &amp; analytics
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>
              All queues · rolling {range?.label} ·{" "}
              <span style={{ color: "var(--text-3)" }}>
                deploy markers correlate regressions with releases
              </span>
              {loading && !data ? " · loading…" : ""}
            </p>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--bg-3)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 2,
              gap: 2,
              fontSize: 11.5,
            }}
          >
            {RANGES.map((r, i) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setRangeIdx(i)}
                style={{
                  padding: "4px 9px",
                  border: 0,
                  background: i === rangeIdx ? "var(--bg-1)" : "transparent",
                  color: i === rangeIdx ? "var(--text-0)" : "var(--text-2)",
                  borderRadius: 6,
                  cursor: "pointer",
                  font: "inherit",
                  boxShadow: i === rangeIdx ? "0 1px 2px rgba(0,0,0,.2)" : undefined,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {error && <ErrorBar message={error} />}

        {!hasData && !loading ? (
          <div
            style={{
              marginTop: 16,
              padding: "40px 18px",
              border: "1px dashed var(--border-strong)",
              borderRadius: 12,
              textAlign: "center",
              color: "var(--text-2)",
              fontSize: 13,
            }}
          >
            No metrics in this window. Live metrics require the collector to be running (
            <span style={mono()}>collectMetrics</span> / <span style={mono()}>startMetrics</span>).
          </div>
        ) : (
          view &&
          data && (
            <>
              <Card style={{ marginTop: 14, padding: "14px 16px 20px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: ".05em",
                      color: "var(--text-2)",
                    }}
                  >
                    THROUGHPUT
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 11,
                      color: "var(--text-2)",
                    }}
                  >
                    <span style={{ width: 8, height: 2, background: "var(--accent)" }} />
                    completed
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 11,
                      color: "var(--text-2)",
                    }}
                  >
                    <span style={{ width: 8, height: 2, background: "var(--st-failed)" }} />
                    failed
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={mono({ fontSize: 11, color: "var(--text-3)" })}>jobs / bucket</span>
                </div>
                <Chart
                  series={[
                    { values: view.comp, color: "var(--accent)" },
                    { values: view.fail, color: "var(--st-failed)" },
                  ]}
                  from={data.from}
                  to={data.now}
                  markers={data.deploys}
                  fmtY={fmt}
                />
              </Card>

              <Card style={{ marginTop: 12, padding: "14px 16px 20px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: ".05em",
                      color: "var(--text-2)",
                    }}
                  >
                    FAILURE RATE
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={mono({ fontSize: 11, color: "var(--text-3)" })}>% of processed</span>
                </div>
                <Chart
                  series={[{ values: view.rate, color: "var(--st-delayed)" }]}
                  from={data.from}
                  to={data.now}
                  height={90}
                  fmtY={(v) => `${v.toFixed(0)}%`}
                />
              </Card>

              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                  gap: 12,
                }}
              >
                {[
                  {
                    label: "WAIT LATENCY",
                    buckets: view.waitP95,
                    hist: view.waitHist,
                    color: "var(--st-active)",
                  },
                  {
                    label: "RUN LATENCY",
                    buckets: view.runP95,
                    hist: view.runHist,
                    color: "var(--st-completed)",
                  },
                ].map((m) => (
                  <Card key={m.label} style={{ padding: "13px 15px 12px" }}>
                    <div
                      style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: ".05em",
                          color: "var(--text-2)",
                        }}
                      >
                        {m.label}
                      </span>
                      <span style={{ flex: 1 }} />
                      <span style={mono({ fontSize: 15, fontWeight: 640 })}>
                        {m.hist.kind === "histogram" && m.hist.totalCount > 0
                          ? fmtDur(percentile(m.hist, 0.95))
                          : "—"}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>p95</span>
                    </div>
                    <Sparkline values={m.buckets} width={480} height={44} color={m.color} />
                  </Card>
                ))}
              </div>
            </>
          )
        )}
      </div>
    </Screen>
  );
}
