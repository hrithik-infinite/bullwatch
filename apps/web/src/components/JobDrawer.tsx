import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { JobDTO } from "../api/types.js";
import { drawer, toast, useDrawer } from "../lib/drawer.js";
import { STATE_COLOR, fmtAge, fmtDur } from "../lib/format.js";
import { JsonTree, countMasked } from "./JsonTree.js";
import { mono } from "./primitives.js";

function deriveState(j: JobDTO): string {
  if (j.failedReason) return "failed";
  if (j.finishedOn) return "completed";
  if (j.processedOn) return "active";
  return "waiting";
}

export function JobDrawer() {
  const target = useDrawer();
  const [job, setJob] = useState<JobDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayText, setReplayText] = useState("");

  useEffect(() => {
    setJob(null);
    setError(null);
    setReplayOpen(false);
    if (!target) return;
    const ac = new AbortController();
    api.job(target.queue, target.id, ac.signal).then(
      (r) => {
        if ("error" in r) setError(r.error);
        else setJob(r);
      },
      (e) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => ac.abort();
  }, [target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && target) drawer.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);

  if (!target) return null;

  const state = job ? deriveState(job) : "waiting";
  const stColor = STATE_COLOR[state] ?? "var(--text-2)";

  const act = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      toast.show(label);
      drawer.close();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    }
  };

  const section = (title: string, color: string, body: React.ReactNode) => (
    <div>
      <div
        style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em", color, marginBottom: 9 }}
      >
        {title}
      </div>
      {body}
    </div>
  );

  const maskedCount = job ? countMasked(job.data) : 0;
  const waitMs = job?.timings.waitMs ?? 0;
  const runMs = job?.timings.runMs ?? 0;
  const totalLife = Math.max(1, waitMs + runMs);

  return (
    <div
      onClick={() => drawer.close()}
      onKeyDown={() => {}}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in oklab, var(--bg-inset) 55%, transparent)",
        backdropFilter: "blur(2px)",
        zIndex: 55,
        display: "flex",
        justifyContent: "flex-end",
        animation: "bw-fade .12s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(94vw, 604px)",
          height: "100%",
          background: "var(--bg-1)",
          borderLeft: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          animation: "bw-over .17s ease",
        }}
      >
        <div
          style={{
            flex: "none",
            padding: "15px 18px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={mono({ fontSize: 14.5, fontWeight: 640 })}>#{target.id}</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 560,
                  textTransform: "capitalize",
                  color: stColor,
                  background: `color-mix(in oklab, ${stColor} 14%, transparent)`,
                  border: `1px solid color-mix(in oklab, ${stColor} 27%, transparent)`,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: stColor }} />
                {state}
              </span>
            </div>
            <div style={{ marginTop: 5, fontSize: 12.5, color: "var(--text-2)" }}>
              <span style={mono({ color: "var(--text-1)" })}>{job?.name ?? "…"}</span> ·{" "}
              <span style={mono()}>{target.queue}</span> · attempt{" "}
              <span style={mono()}>{job?.attemptsMade ?? "—"}</span>
            </div>
          </div>
          <button
            type="button"
            data-bw-ghost=""
            onClick={() => drawer.close()}
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
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            flex: "none",
            display: "flex",
            gap: 8,
            padding: "11px 18px",
            borderBottom: "1px solid var(--border)",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {state === "failed" && (
            <button
              type="button"
              onClick={() => act(() => api.retry(target.queue, target.id), "Job retried")}
              style={{
                border: 0,
                background: "var(--accent)",
                color: "#fff",
                font: "inherit",
                fontSize: 12,
                fontWeight: 560,
                padding: "6px 13px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            data-bw-ghost=""
            onClick={() => act(() => api.promote(target.queue, target.id), "Job promoted")}
            style={{
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              font: "inherit",
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Promote
          </button>
          <button
            type="button"
            data-bw-ghost=""
            onClick={() => act(() => api.remove(target.queue, target.id), "Job removed")}
            style={{
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-1)",
              font: "inherit",
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Remove
          </button>
          <span style={{ flex: 1 }} />
          {state === "failed" && (
            <button
              type="button"
              onClick={() => {
                setReplayText(JSON.stringify(job?.data ?? {}, null, 2));
                setReplayOpen((o) => !o);
              }}
              style={{
                border: "1px solid var(--accent-line)",
                background: "var(--accent-weak)",
                color: "var(--accent)",
                font: "inherit",
                fontSize: 12,
                fontWeight: 560,
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              ↺ Replay with edited payload
            </button>
          )}
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "16px 18px 44px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {error && <div style={{ color: "var(--st-failed)", fontSize: 12.5 }}>{error}</div>}

          {replayOpen && (
            <div
              style={{
                border: "1px solid var(--accent-line)",
                borderRadius: 10,
                padding: 12,
                background: "var(--accent-weak)",
              }}
            >
              <div
                style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", marginBottom: 8 }}
              >
                REPLAY — edit payload, then re-enqueue as a new job (original kept)
              </div>
              <textarea
                value={replayText}
                onChange={(e) => setReplayText(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: 140,
                  boxSizing: "border-box",
                  background: "var(--bg-inset)",
                  color: "var(--text-0)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  ...mono({ fontSize: 12 }),
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={async () => {
                    let parsed: unknown;
                    try {
                      parsed = JSON.parse(replayText);
                    } catch {
                      toast.show("Invalid JSON");
                      return;
                    }
                    await act(
                      () => api.replay(target.queue, target.id, parsed),
                      "Replayed as a new job",
                    );
                  }}
                  style={{
                    border: 0,
                    background: "var(--accent)",
                    color: "#fff",
                    font: "inherit",
                    fontSize: 12,
                    fontWeight: 560,
                    padding: "6px 13px",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Submit replay
                </button>
                <button
                  type="button"
                  data-bw-ghost=""
                  onClick={() => setReplayOpen(false)}
                  style={{
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text-1)",
                    font: "inherit",
                    fontSize: 12,
                    padding: "6px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {section(
            "LIFECYCLE",
            "var(--text-3)",
            <>
              <div
                style={{
                  display: "flex",
                  height: 28,
                  borderRadius: 8,
                  overflow: "hidden",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    width: `${(waitMs / totalLife) * 100}%`,
                    minWidth: 0,
                    background: "color-mix(in oklab, var(--st-delayed) 26%, var(--bg-2))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    color: "var(--st-delayed)",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                  }}
                >
                  wait <span style={mono()}>{fmtDur(job?.timings.waitMs ?? null)}</span>
                </div>
                <div
                  style={{
                    width: `${(runMs / totalLife) * 100}%`,
                    minWidth: 0,
                    background: "color-mix(in oklab, var(--accent) 24%, var(--bg-2))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    color: "var(--accent)",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                  }}
                >
                  run <span style={mono()}>{fmtDur(job?.timings.runMs ?? null)}</span>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 6,
                  fontSize: 11,
                  color: "var(--text-3)",
                  ...mono(),
                }}
              >
                <span>created {fmtAge(job?.timestamp ?? null)} ago</span>
                <span>
                  {job?.finishedOn ? `finished ${fmtAge(job.finishedOn)} ago` : "unfinished"}
                </span>
              </div>
            </>,
          )}

          {job?.failedReason &&
            section(
              "STACK TRACE",
              "var(--st-failed)",
              <>
                <div
                  style={{
                    ...mono({ fontSize: 12 }),
                    color: "var(--st-failed)",
                    background: "color-mix(in oklab, var(--st-failed) 9%, var(--bg-inset))",
                    border: "1px solid color-mix(in oklab, var(--st-failed) 24%, transparent)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    marginBottom: 8,
                  }}
                >
                  {job.failedReason}
                </div>
                {job.stacktrace.length > 0 && (
                  <pre
                    style={{
                      margin: 0,
                      ...mono({ fontSize: 11.5 }),
                      lineHeight: 1.65,
                      color: "var(--text-1)",
                      background: "var(--bg-inset)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "11px 13px",
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {job.stacktrace.join("\n")}
                  </pre>
                )}
              </>,
            )}

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: ".05em",
                  color: "var(--text-3)",
                }}
              >
                PAYLOAD
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 10.5,
                  color: "var(--st-completed)",
                  background: "color-mix(in oklab, var(--st-completed) 11%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--st-completed) 24%, transparent)",
                  borderRadius: 5,
                  padding: "1px 7px",
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--st-completed)",
                  }}
                />
                read live · never stored
              </span>
              <span style={{ flex: 1 }} />
              {maskedCount > 0 && (
                <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                  {maskedCount} field{maskedCount === 1 ? "" : "s"} masked
                </span>
              )}
            </div>
            <div
              style={{
                background: "var(--bg-inset)",
                border: "1px solid var(--border)",
                borderRadius: 9,
                padding: "10px 8px",
                overflow: "auto",
                maxHeight: 320,
              }}
            >
              {job ? (
                <JsonTree value={job.data} />
              ) : (
                <span style={mono({ color: "var(--text-3)", fontSize: 12 })}>loading…</span>
              )}
            </div>
          </div>

          {job?.returnvalue != null &&
            section(
              "RESULT",
              "var(--text-3)",
              <div
                style={{
                  background: "var(--bg-inset)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 8px",
                  overflow: "auto",
                  maxHeight: 240,
                }}
              >
                <JsonTree value={job.returnvalue} />
              </div>,
            )}
        </div>
      </div>
    </div>
  );
}
