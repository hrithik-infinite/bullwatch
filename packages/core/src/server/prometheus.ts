import type { QueueSummary } from "../bullmq/readers.js";

/**
 * Render queue summaries as Prometheus text exposition format. Pure. This is the
 * local-first-safe integration path: bullwatch exposes a scrape endpoint the
 * user's own Prometheus pulls from — data is pushed from the user's box to
 * infrastructure they control, never to a third party.
 */
export function renderPrometheus(summaries: ReadonlyArray<QueueSummary>): string {
  const lines: string[] = [];

  lines.push("# HELP bullwatch_job_count Number of jobs per queue and state.");
  lines.push("# TYPE bullwatch_job_count gauge");
  for (const summary of summaries) {
    for (const [state, count] of Object.entries(summary.counts)) {
      lines.push(
        `bullwatch_job_count{queue="${escapeLabel(summary.name)}",state="${escapeLabel(state)}"} ${count}`,
      );
    }
  }

  lines.push("# HELP bullwatch_queue_paused Whether a queue is paused (1) or not (0).");
  lines.push("# TYPE bullwatch_queue_paused gauge");
  for (const summary of summaries) {
    lines.push(
      `bullwatch_queue_paused{queue="${escapeLabel(summary.name)}"} ${summary.paused ? 1 : 0}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
