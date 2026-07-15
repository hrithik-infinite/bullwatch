import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { QueueSummary, SearchResult } from "../api/types.js";
import { Icons } from "../components/icons.js";
import { Card, mono } from "../components/primitives.js";
import { fmt, fmtAge } from "../lib/format.js";
import { Screen } from "./shared.js";

const preview = (data: unknown): string => {
  if (data === null || data === undefined) return "—";
  try {
    const s = JSON.stringify(data);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return String(data);
  }
};

export function Search({ queues }: { queues: QueueSummary[] | null }) {
  const list = queues ?? [];
  const [queue, setQueue] = useState<string>("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the queue selection once queues load.
  useEffect(() => {
    if (!queue && list.length > 0) setQueue(list[0]?.name ?? "");
  }, [list, queue]);

  const run = async (perStateLimit: number) => {
    if (!queue) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.search(queue, { q: query, limit: perStateLimit });
      setResult(r);
      setLimit(perStateLimit);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen label="Search">
      <div style={{ padding: "18px 18px 4px" }}>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 640, letterSpacing: "-.01em" }}>
          Search
        </h1>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>
          Read-through, budgeted scan — nothing is indexed. Try{" "}
          <span style={mono()}>userId:42</span>, <span style={mono()}>status:failed</span>, or a
          free-text term.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, padding: "14px 18px 8px", alignItems: "center" }}>
        <select
          value={queue}
          onChange={(e) => setQueue(e.target.value)}
          style={{
            height: 34,
            background: "var(--bg-3)",
            color: "var(--text-0)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0 10px",
            font: "inherit",
            fontSize: 12.5,
            ...mono(),
          }}
        >
          {list.length === 0 && <option value="">no queues</option>}
          {list.map((q) => (
            <option key={q.name} value={q.name}>
              {q.name}
            </option>
          ))}
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(100);
          }}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 34,
            padding: "0 11px",
            background: "var(--bg-inset)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          {Icons.search(14)}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="field:value or free text…"
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: "none",
              color: "var(--text-0)",
              font: "inherit",
              fontSize: 13,
              ...mono(),
            }}
          />
        </form>
        <button
          type="button"
          onClick={() => void run(100)}
          disabled={!queue || busy}
          style={{
            border: 0,
            background: "var(--accent)",
            color: "#fff",
            font: "inherit",
            fontSize: 12.5,
            fontWeight: 560,
            padding: "8px 16px",
            borderRadius: 8,
            cursor: queue ? "pointer" : "not-allowed",
            opacity: queue ? 1 : 0.5,
          }}
        >
          {busy ? "Scanning…" : "Search"}
        </button>
      </div>

      {error && (
        <div style={{ padding: "0 18px 8px", color: "var(--st-failed)", fontSize: 12.5 }}>
          {error}
        </div>
      )}

      {result && (
        <Card style={{ margin: "6px 18px 22px", overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              fontSize: 11.5,
              color: "var(--text-2)",
            }}
          >
            <span>
              <span style={mono({ color: "var(--text-0)" })}>{result.jobs.length}</span> matches ·
              scanned <span style={mono({ color: "var(--text-1)" })}>{fmt(result.scanned)}</span>
            </span>
            {result.truncated && (
              <>
                <span style={{ color: "var(--st-delayed)" }}>
                  · budget hit — deeper matches may exist
                </span>
                <button
                  type="button"
                  data-bw-ghost=""
                  onClick={() => void run(Math.min(1000, limit * 2))}
                  style={{
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text-1)",
                    font: "inherit",
                    fontSize: 11,
                    padding: "3px 9px",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Scan more
                </button>
              </>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ color: "var(--text-3)" }}>payloads read live · never stored</span>
          </div>
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-row)" }}>
              <tbody>
                {result.jobs.map((j) => (
                  <tr
                    key={j.id ?? Math.random()}
                    data-bw-row=""
                    style={{ borderBottom: "1px solid var(--border-faint)" }}
                  >
                    <td style={{ padding: "var(--cell-py) var(--cell-px)", width: "12%" }}>
                      <span style={mono({ fontSize: 12, color: "var(--accent)" })}>#{j.id}</span>
                    </td>
                    <td style={{ padding: "var(--cell-py) var(--cell-px)", width: "16%" }}>
                      <span style={mono({ fontSize: 12.5, color: "var(--text-0)" })}>{j.name}</span>
                    </td>
                    <td style={{ padding: "var(--cell-py) var(--cell-px)" }}>
                      <span style={mono({ fontSize: 11.5, color: "var(--text-2)" })}>
                        {preview(j.data)}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "var(--cell-py) var(--cell-px)",
                        textAlign: "right",
                        width: "8%",
                      }}
                    >
                      <span style={mono({ fontSize: 11.5, color: "var(--text-3)" })}>
                        {fmtAge(j.timestamp)}
                      </span>
                    </td>
                  </tr>
                ))}
                {result.jobs.length === 0 && (
                  <tr>
                    <td
                      style={{
                        padding: "24px 14px",
                        textAlign: "center",
                        color: "var(--text-2)",
                        fontSize: 12.5,
                      }}
                    >
                      No matches in the scanned window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Screen>
  );
}
