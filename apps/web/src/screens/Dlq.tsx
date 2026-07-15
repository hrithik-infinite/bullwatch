import { useMemo } from "react";
import { api } from "../api/client.js";
import type { QueueSummary } from "../api/types.js";
import { Card, Sparkline, mono } from "../components/primitives.js";
import { usePoll } from "../hooks/usePoll.js";
import { drawer } from "../lib/drawer.js";
import { fmt } from "../lib/format.js";
import { ErrorBar, Screen } from "./shared.js";

interface AggSig {
  errorSignature: string;
  count: number;
  trend: number[];
  queues: Set<string>;
  samples: Array<{ queue: string; id: string }>;
  delta: number;
}

export function Dlq({ queues }: { queues: QueueSummary[] | null }) {
  const names = useMemo(
    () => (queues ?? []).filter((q) => (q.counts.failed ?? 0) > 0).map((q) => q.name),
    [queues],
  );

  const { data, error, loading } = usePoll(
    async (signal) => {
      const now = Date.now();
      const from = now - 24 * 60 * 60 * 1000;
      const per = await Promise.all(
        names.map((name) =>
          api
            .failures(name, { from, to: now, topN: 20, trendBuckets: 24, samples: true }, signal)
            .then((r) => ({ name, r }))
            .catch(() => ({ name, r: null })),
        ),
      );
      const map = new Map<string, AggSig>();
      let totalFailures = 0;
      for (const { name, r } of per) {
        if (!r) continue;
        totalFailures += r.totalFailures;
        for (const s of r.signatures) {
          let agg = map.get(s.errorSignature);
          if (!agg) {
            agg = {
              errorSignature: s.errorSignature,
              count: 0,
              trend: new Array(s.trend.length).fill(0),
              queues: new Set(),
              samples: [],
              delta: 0,
            };
            map.set(s.errorSignature, agg);
          }
          agg.count += s.count;
          agg.delta += s.delta;
          agg.queues.add(name);
          s.trend.forEach((v, i) => {
            agg.trend[i] = (agg.trend[i] ?? 0) + v;
          });
          for (const id of s.sampleJobIds ?? []) agg.samples.push({ queue: name, id });
        }
      }
      const signatures = [...map.values()].sort((a, b) => b.count - a.count);
      return { signatures, totalFailures };
    },
    [names.join(",")],
    8_000,
  );

  const sigs = data?.signatures ?? [];

  return (
    <Screen label="Dead-letter">
      <div style={{ padding: "18px 18px 44px", maxWidth: 1000 }}>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 660, letterSpacing: "-.01em" }}>
          Dead-letter &amp; failure analysis
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>
          <span style={mono({ color: "var(--st-failed)" })}>{fmt(data?.totalFailures ?? 0)}</span>{" "}
          failed jobs grouped into <span style={mono()}>{sigs.length}</span> normalized error
          signatures · last 24h
          {loading && !data ? " · loading…" : ""}
        </p>

        {error && <ErrorBar message={error} />}

        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {sigs.map((g) => {
            const pct =
              data && data.totalFailures > 0
                ? ((g.count / data.totalFailures) * 100).toFixed(0)
                : "0";
            return (
              <Card
                key={g.errorSignature}
                style={{ padding: "13px 15px", display: "flex", alignItems: "center", gap: 16 }}
              >
                <div style={{ width: 66, flex: "none", textAlign: "center" }}>
                  <div style={mono({ fontSize: 20, fontWeight: 660, color: "var(--st-failed)" })}>
                    {fmt(g.count)}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-3)" }}>{pct}% of fails</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={mono({
                      fontSize: 12.5,
                      color: "var(--text-0)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    })}
                  >
                    {g.errorSignature}
                  </div>
                  <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-3)" }}>
                    <span style={mono()}>{[...g.queues].join(", ")}</span> ·{" "}
                    {g.delta > 0 ? (
                      <span style={{ color: "var(--st-failed)" }}>▲ rising</span>
                    ) : g.delta < 0 ? (
                      <span style={{ color: "var(--st-completed)" }}>▼ falling</span>
                    ) : (
                      "steady"
                    )}
                  </div>
                  {g.samples.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {g.samples.slice(0, 6).map((s) => (
                        <button
                          key={`${s.queue}:${s.id}`}
                          type="button"
                          data-bw-ghost=""
                          onClick={() => drawer.open(s.queue, s.id)}
                          style={{
                            border: "1px solid var(--border)",
                            background: "var(--bg-inset)",
                            ...mono({ fontSize: 11, color: "var(--accent)" }),
                            padding: "1px 7px",
                            borderRadius: 5,
                            cursor: "pointer",
                          }}
                        >
                          #{s.id}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    flex: "none",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 3,
                  }}
                >
                  <span style={{ fontSize: 10, color: "var(--text-3)" }}>24h</span>
                  <Sparkline values={g.trend} width={90} height={26} color="var(--st-failed)" />
                </div>
              </Card>
            );
          })}
          {sigs.length === 0 && !loading && (
            <div
              style={{
                padding: "40px 18px",
                border: "1px dashed var(--border-strong)",
                borderRadius: 12,
                textAlign: "center",
                color: "var(--text-2)",
                fontSize: 13,
              }}
            >
              No failures in the last 24h. Failure signatures appear here once jobs fail (requires
              the metrics collector to be running).
            </div>
          )}
        </div>
      </div>
    </Screen>
  );
}
