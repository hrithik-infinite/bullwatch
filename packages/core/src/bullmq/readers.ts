import type { JobType, Queue } from "bullmq";
import { type JobDTO, toJobDTO } from "./job-dto.js";

export interface QueueSummary {
  readonly name: string;
  readonly counts: Record<string, number>;
  readonly paused: boolean;
  readonly total: number;
}

export interface JobRange {
  readonly start: number;
  readonly end: number;
}

/** Counts per state plus paused flag. All O(1) in Redis — cheap to poll. */
export async function getQueueSummary(queue: Queue): Promise<QueueSummary> {
  const [counts, paused] = await Promise.all([queue.getJobCounts(), queue.isPaused()]);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { name: queue.name, counts, paused, total };
}

/**
 * List jobs in a state as DTOs. Payloads pass through for live rendering and
 * are never persisted. `range` is required — callers must paginate; this never
 * fetches an unbounded list (the expensive path on large queues).
 */
export async function listJobs(
  queue: Queue,
  state: JobType,
  range: JobRange,
  now: number,
): Promise<JobDTO[]> {
  const jobs = await queue.getJobs([state], range.start, range.end);
  return jobs.map((job) => toJobDTO(job, queue.name, now));
}

export async function getJobDetail(queue: Queue, id: string, now: number): Promise<JobDTO | null> {
  const job = await queue.getJob(id);
  return job ? toJobDTO(job, queue.name, now) : null;
}

export interface WorkerDTO {
  readonly id: string | null;
  readonly addr: string | null;
  readonly name: string | null;
  readonly ageSeconds: number | null;
  readonly idleSeconds: number | null;
}

function numOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * List workers connected to this queue. Backed by Redis CLIENT LIST, so it
 * reports connection presence, not application concurrency (which BullMQ keeps
 * in-process and never writes to Redis). Some managed Redis providers disable
 * CLIENT LIST; there this returns an empty list rather than throwing.
 */
export async function getWorkers(queue: Queue): Promise<WorkerDTO[]> {
  const workers = await queue.getWorkers();
  return workers.map((w) => ({
    id: w.id ?? null,
    addr: w.addr ?? null,
    name: w.name ?? null,
    ageSeconds: numOrNull(w.age),
    idleSeconds: numOrNull(w.idle),
  }));
}
