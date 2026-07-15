import { useState } from "react";
import { api } from "../api/client.js";
import type { JobDTO, QueueSummary } from "../api/types.js";
import { Card, mono } from "../components/primitives.js";
import { drawer } from "../lib/drawer.js";
import { STATE_COLOR, fmtDur } from "../lib/format.js";
import { Screen } from "./shared.js";

interface FlowNode {
  job: JobDTO;
  children: FlowNode[];
}

function deriveState(j: JobDTO): string {
  if (j.failedReason) return "failed";
  if (j.finishedOn) return "completed";
  if (j.processedOn) return "active";
  return "waiting";
}

function TreeNode({ node, queue, depth }: { node: FlowNode; queue: string; depth: number }) {
  const state = deriveState(node.job);
  const color = STATE_COLOR[state] ?? "var(--text-2)";
  return (
    <div>
      <button
        type="button"
        data-bw-row=""
        onClick={() => node.job.id && drawer.open(node.job.queue || queue, node.job.id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          width: "100%",
          padding: "7px 10px",
          paddingLeft: 10 + depth * 22,
          border: 0,
          background: "transparent",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
          borderRadius: 7,
        }}
      >
        {depth > 0 && <span style={{ color: "var(--text-3)", marginLeft: -14 }}>└</span>}
        <span
          style={{ width: 7, height: 7, borderRadius: "50%", background: color, flex: "none" }}
        />
        <span style={mono({ fontSize: 12.5, color: "var(--accent)" })}>#{node.job.id}</span>
        <span style={mono({ fontSize: 12.5, color: "var(--text-0)" })}>{node.job.name}</span>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{node.job.queue}</span>
        <span style={{ flex: 1 }} />
        <span style={mono({ fontSize: 11, color: "var(--text-2)" })}>
          {fmtDur(node.job.timings.runMs)}
        </span>
      </button>
      {node.children.map((c) => (
        <TreeNode key={c.job.id ?? Math.random()} node={c} queue={queue} depth={depth + 1} />
      ))}
    </div>
  );
}

export function Flows({ queues }: { queues: QueueSummary[] | null }) {
  const list = queues ?? [];
  const [queue, setQueue] = useState(list[0]?.name ?? "");
  const [id, setId] = useState("");
  const [tree, setTree] = useState<FlowNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!queue || !id) return;
    setBusy(true);
    setError(null);
    setTree(null);
    try {
      setTree((await api.flow(queue, id)) as FlowNode);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("404") ? "No flow found for that job id." : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen label="Flows">
      <div style={{ padding: "18px 18px 44px", maxWidth: 1000 }}>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 660, letterSpacing: "-.01em" }}>Flows</h1>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>
          Inspect a parent-child job DAG. Enter a parent job id — child jobs are traversed live from
          Redis.
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
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
            {list.map((q) => (
              <option key={q.name} value={q.name}>
                {q.name}
              </option>
            ))}
          </select>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load();
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
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="parent job id…"
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
            onClick={() => void load()}
            disabled={!queue || !id || busy}
            style={{
              border: 0,
              background: "var(--accent)",
              color: "#fff",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 560,
              padding: "8px 16px",
              borderRadius: 8,
              cursor: queue && id ? "pointer" : "not-allowed",
              opacity: queue && id ? 1 : 0.5,
            }}
          >
            {busy ? "Loading…" : "Load flow"}
          </button>
        </div>

        {error && (
          <p style={{ color: "var(--st-failed)", fontSize: 12.5, marginTop: 12 }}>{error}</p>
        )}

        {tree && (
          <Card style={{ marginTop: 14, padding: "8px 6px" }}>
            <TreeNode node={tree} queue={queue} depth={0} />
          </Card>
        )}
      </div>
    </Screen>
  );
}
