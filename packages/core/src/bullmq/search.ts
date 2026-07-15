import type { JobType, Queue } from "bullmq";
import { matchesQuery, parseSearchQuery } from "../domain/search-query.js";
import { type JobDTO, toJobDTO } from "./job-dto.js";

export interface SearchOptions {
  readonly query: string;
  readonly states: ReadonlyArray<JobType>;
  /** Max jobs fetched per state — the scan budget. */
  readonly perStateLimit: number;
  readonly now: number;
}

export interface SearchResult {
  readonly jobs: JobDTO[];
  /** Total jobs fetched from Redis (the cost of this search). */
  readonly scanned: number;
  /** True if any state hit the budget — more matches may exist deeper. */
  readonly truncated: boolean;
}

/**
 * Budgeted, read-through job search. Fetches up to `perStateLimit` jobs per
 * state and applies the parsed predicate in-process. Nothing is indexed, so the
 * never-persist invariant holds; the cost is surfaced honestly as `scanned` and
 * `truncated` rather than hidden, and the caller controls the budget. Deep-queue
 * exhaustiveness is explicitly traded away for zero index and zero payload
 * persistence — the UI shows "scanned N, scan more".
 */
export async function searchJobs(queue: Queue, opts: SearchOptions): Promise<SearchResult> {
  const query = parseSearchQuery(opts.query);
  const jobs: JobDTO[] = [];
  let scanned = 0;
  let truncated = false;

  for (const state of opts.states) {
    const batch = await queue.getJobs([state], 0, opts.perStateLimit - 1);
    scanned += batch.length;
    if (batch.length >= opts.perStateLimit) truncated = true;
    for (const job of batch) {
      if (matchesQuery({ id: job.id ?? null, name: job.name, data: job.data }, query)) {
        jobs.push(toJobDTO(job, queue.name, opts.now));
      }
    }
  }

  return { jobs, scanned, truncated };
}
