import { describe, expect, it } from "vitest";
import type { QueueSummary } from "../bullmq/readers.js";
import { renderPrometheus } from "./prometheus.js";

describe("renderPrometheus", () => {
  const summaries: QueueSummary[] = [
    { name: "email", counts: { waiting: 3, active: 1, failed: 2 }, paused: false, total: 6 },
    { name: "billing", counts: { waiting: 0 }, paused: true, total: 0 },
  ];

  it("emits HELP/TYPE headers once per metric", () => {
    const text = renderPrometheus(summaries);
    expect(text.match(/# TYPE bullwatch_job_count gauge/g)).toHaveLength(1);
    expect(text.match(/# TYPE bullwatch_queue_paused gauge/g)).toHaveLength(1);
  });

  it("emits a job-count sample per queue and state", () => {
    const text = renderPrometheus(summaries);
    expect(text).toContain('bullwatch_job_count{queue="email",state="waiting"} 3');
    expect(text).toContain('bullwatch_job_count{queue="email",state="failed"} 2');
    expect(text).toContain('bullwatch_queue_paused{queue="billing"} 1');
    expect(text).toContain('bullwatch_queue_paused{queue="email"} 0');
  });

  it("escapes label values", () => {
    const text = renderPrometheus([
      { name: 'we"ird\\', counts: { waiting: 1 }, paused: false, total: 1 },
    ]);
    expect(text).toContain('bullwatch_job_count{queue="we\\"ird\\\\",state="waiting"} 1');
  });

  it("ends with a trailing newline (Prometheus text format requirement)", () => {
    expect(renderPrometheus(summaries).endsWith("\n")).toBe(true);
  });
});
