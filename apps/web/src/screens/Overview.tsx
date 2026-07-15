import type { QueueSummary } from "../api/types.js";
import { Card, Meter, Pill, mono } from "../components/primitives.js";
import { fmt } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { Screen, Th, headerCell } from "./shared.js";

const failRate = (q: QueueSummary): number => {
  const completed = q.counts.completed ?? 0;
  const failed = q.counts.failed ?? 0;
  const total = completed + failed;
  return total === 0 ? 0 : (failed / total) * 100;
};

function Kpi({
  label,
  value,
  unit,
  accent,
}: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <Card style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", color: "var(--text-2)" }}
        >
          {label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          style={mono({ fontSize: 26, fontWeight: 640, letterSpacing: "-.02em", color: accent })}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 15, color: "var(--text-2)" }}>{unit}</span>}
      </div>
    </Card>
  );
}

export function Overview({
  queues,
  loading,
  error,
}: { queues: QueueSummary[] | null; loading: boolean; error: string | null }) {
  const list = queues ?? [];
  const sum = (k: string) => list.reduce((a, q) => a + (q.counts[k] ?? 0), 0);
  const totalWaiting = sum("waiting");
  const totalActive = sum("active");
  const totalFailed = sum("failed");
  const totalCompleted = sum("completed");
  const paused = list.filter((q) => q.paused).length;
  const overallFr =
    totalCompleted + totalFailed === 0 ? 0 : (totalFailed / (totalCompleted + totalFailed)) * 100;

  return (
    <Screen label="Overview">
      <div style={{ padding: "18px 18px 4px" }}>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 640, letterSpacing: "-.01em" }}>
          Overview
        </h1>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>
          {list.length} queues ·{" "}
          <span style={mono()}>{fmt(list.reduce((a, q) => a + q.total, 0))}</span> jobs tracked
          {error ? (
            <span style={{ color: "var(--st-failed)" }}> · {error}</span>
          ) : loading && !queues ? (
            " · loading…"
          ) : (
            ""
          )}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,minmax(0,1fr))",
          gap: 12,
          padding: "14px 18px 6px",
        }}
      >
        <Kpi
          label="WAITING"
          value={fmt(totalWaiting)}
          accent={totalWaiting > 0 ? "var(--st-waiting)" : undefined}
        />
        <Kpi label="ACTIVE" value={fmt(totalActive)} accent="var(--st-active)" />
        <Kpi
          label="FAILED"
          value={fmt(totalFailed)}
          accent={totalFailed > 0 ? "var(--st-failed)" : undefined}
        />
        <Kpi
          label="QUEUES"
          value={String(list.length)}
          unit={paused ? `${paused} paused` : undefined}
        />
      </div>

      <Card style={{ margin: "14px 18px 22px", overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "11px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>Queues</span>
          <span
            style={mono({
              fontSize: 11,
              color: "var(--text-3)",
              background: "var(--bg-3)",
              padding: "1px 6px",
              borderRadius: 5,
            })}
          >
            {list.length}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            overall fail rate{" "}
            <span
              style={mono({ color: overallFr > 2 ? "var(--st-failed)" : "var(--st-completed)" })}
            >
              {overallFr.toFixed(1)}%
            </span>
          </span>
        </div>
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-row)" }}>
            <thead>
              <tr style={{ color: "var(--text-2)" }}>
                <Th>QUEUE</Th>
                <Th align="right">WAITING</Th>
                <Th align="right">ACTIVE</Th>
                <Th align="right">COMPLETED</Th>
                <Th align="right">FAILED</Th>
                <Th align="right">DELAYED</Th>
                <Th>FAIL RATE</Th>
                <th style={headerCell()} />
              </tr>
            </thead>
            <tbody>
              {list.map((q) => {
                const fr = failRate(q);
                const frColor =
                  fr > 5
                    ? "var(--st-failed)"
                    : fr > 1
                      ? "var(--st-delayed)"
                      : "var(--st-completed)";
                const cell = (color?: string) =>
                  mono({
                    textAlign: "right" as const,
                    padding: "var(--cell-py) var(--cell-px)",
                    color,
                  });
                return (
                  <tr
                    key={q.name}
                    data-bw-row=""
                    onClick={() => navigate({ name: "queue", queue: q.name })}
                    style={{ cursor: "pointer", borderBottom: "1px solid var(--border-faint)" }}
                  >
                    <td style={{ padding: "var(--cell-py) var(--cell-px)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={mono({ fontSize: 12.5, fontWeight: 560, color: "var(--text-0)" })}
                        >
                          {q.name}
                        </span>
                        {q.paused && <Pill color="var(--st-paused)">PAUSED</Pill>}
                      </div>
                    </td>
                    <td style={cell("var(--text-1)")}>{fmt(q.counts.waiting ?? 0)}</td>
                    <td
                      style={cell(
                        (q.counts.active ?? 0) > 0 ? "var(--st-active)" : "var(--text-2)",
                      )}
                    >
                      {fmt(q.counts.active ?? 0)}
                    </td>
                    <td style={cell("var(--text-2)")}>{fmt(q.counts.completed ?? 0)}</td>
                    <td
                      style={cell(
                        (q.counts.failed ?? 0) > 0 ? "var(--st-failed)" : "var(--text-2)",
                      )}
                    >
                      {fmt(q.counts.failed ?? 0)}
                    </td>
                    <td
                      style={cell(
                        (q.counts.delayed ?? 0) > 0 ? "var(--st-delayed)" : "var(--text-2)",
                      )}
                    >
                      {fmt(q.counts.delayed ?? 0)}
                    </td>
                    <td style={{ padding: "var(--cell-py) var(--cell-px)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <Meter pct={fr} color={frColor} />
                        <span style={mono({ fontSize: 11.5, color: frColor })}>
                          {fr.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: "center", color: "var(--text-3)", padding: "0 6px" }}>
                      ›
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      padding: "28px 14px",
                      textAlign: "center",
                      color: "var(--text-2)",
                      fontSize: 12.5,
                    }}
                  >
                    No queues discovered. Add a job to a BullMQ queue, or set{" "}
                    <span style={mono()}>BULLWATCH_QUEUES</span>.
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
