import type { JobType, Queue } from "bullmq";
import { type MaskConfig, applyMask } from "../domain/mask.js";
import { matchesQuery, parseSearchQuery } from "../domain/search-query.js";
import { type JobDTO, toJobDTO } from "./job-dto.js";

export interface SearchOptions {
  readonly query: string;
  readonly states: ReadonlyArray<JobType>;
  /** Max jobs fetched per state — the scan budget. */
  readonly perStateLimit: number;
  readonly now: number;
  /**
   * Redact matching payload fields. Applied to the data the predicate runs
   * against, not just the returned DTO — so a masked field cannot be extracted
   * by probing search (e.g. `password:a`, `password:ab`, …).
   */
  readonly mask?: MaskConfig;
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
      const data = opts.mask ? applyMask(job.data, opts.mask) : job.data;
      if (matchesQuery({ id: job.id ?? null, name: job.name, data }, query)) {
        jobs.push(toJobDTO(job, queue.name, opts.now, { mask: opts.mask }));
      }
    }
  }

  return { jobs, scanned, truncated };
}
