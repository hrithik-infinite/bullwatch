import { api } from "../api/client.js";
import { Card, mono } from "../components/primitives.js";
import { usePoll } from "../hooks/usePoll.js";
import { fmtAge } from "../lib/format.js";
import { ErrorBar, Screen, Th } from "./shared.js";

const TYPE_LABEL: Record<string, string> = {
  failure_rate: "Failure rate",
  queue_depth: "Queue depth",
  latency: "Latency",
};

export function Alerts() {
  const { data, error, loading } = usePoll((s) => api.alerts(s), [], 6_000);
  const rules = data?.alerts ?? [];
  const firing = rules.filter((r) => r.status === "firing").length;

  return (
    <Screen label="Alerts">
      <div style={{ padding: "18px 18px 44px", maxWidth: 1000 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 660, letterSpacing: "-.01em" }}>
              Alerts
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>
              <span
                style={mono({ color: firing > 0 ? "var(--st-failed)" : "var(--st-completed)" })}
              >
                {firing}
              </span>{" "}
              rule{firing === 1 ? "" : "s"} firing · notifications go only to endpoints you control
              {loading && !data ? " · loading…" : ""}
            </p>
          </div>
        </div>

        {error && <ErrorBar message={error} />}

        <div
          style={{
            marginTop: 16,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: ".05em",
            color: "var(--text-3)",
            marginBottom: 9,
          }}
        >
          RULES
        </div>
        <Card style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-row)" }}>
            <thead>
              <tr style={{ color: "var(--text-2)" }}>
                <Th>STATUS</Th>
                <Th>RULE</Th>
                <Th>TYPE</Th>
                <Th>SCOPE</Th>
                <Th align="right">CURRENT</Th>
                <Th align="right">SINCE</Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const color = r.status === "firing" ? "var(--st-failed)" : "var(--st-completed)";
                return (
                  <tr key={r.ruleId} style={{ borderBottom: "1px solid var(--border-faint)" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11.5,
                          color,
                          textTransform: "capitalize",
                        }}
                      >
                        <span
                          style={{ width: 7, height: 7, borderRadius: "50%", background: color }}
                        />
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--text-0)" }}>
                      <span style={mono({ fontSize: 12 })}>{r.ruleId}</span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--text-1)", fontSize: 12 }}>
                      {TYPE_LABEL[r.type] ?? r.type}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={mono({ fontSize: 12, color: "var(--st-active)" })}>
                        {r.queue}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <span style={mono({ fontSize: 12, color: "var(--text-1)" })}>
                        {r.type === "failure_rate"
                          ? `${(r.lastValue * 100).toFixed(1)}%`
                          : r.type === "latency"
                            ? `${Math.round(r.lastValue)}ms`
                            : Math.round(r.lastValue)}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <span style={mono({ fontSize: 11.5, color: "var(--text-3)" })}>
                        {r.firstBreachAt ? `${fmtAge(r.firstBreachAt)} ago` : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rules.length === 0 && !loading && (
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
                    No alert rules configured. Set <span style={mono()}>BULLWATCH_ALERTS</span>{" "}
                    (JSON rules + webhook URLs) or pass <span style={mono()}>alerts</span> to{" "}
                    <span style={mono()}>createBullwatch</span>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <p style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}>
          Webhook targets are configured server-side and never exposed through the API. Breaches
          POST to your own endpoints (Slack, Discord, PagerDuty) — nothing leaves your
          infrastructure.
        </p>
      </div>
    </Screen>
  );
}
