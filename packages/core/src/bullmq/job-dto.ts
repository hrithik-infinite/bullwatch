import { errorSignature } from "../domain/error-signature.js";
import { type JobTimings, deriveTimings } from "../domain/timings.js";

/**
 * The subset of a BullMQ `Job` that bullwatch reads. Declaring it explicitly
 * (rather than importing bullmq's `Job`) keeps the mapping pure and unit-
 * testable, and documents exactly which fields we depend on — a real `Job`
 * structurally satisfies this (asserted by the integration tests).
 */
export interface JobLike {
  readonly id?: string | null;
  readonly name: string;
  readonly attemptsMade: number;
  readonly timestamp: number;
  readonly processedOn?: number | null;
  readonly finishedOn?: number | null;
  readonly data: unknown;
  readonly opts: unknown;
  readonly returnvalue?: unknown;
  readonly failedReason?: string | null;
  readonly stacktrace?: string[] | null;
  readonly progress?: number | string | boolean | object | null;
  readonly parentKey?: string | null;
}

export interface JobDTO {
  readonly id: string | null;
  readonly name: string;
  readonly queue: string;
  readonly attemptsMade: number;
  readonly timestamp: number;
  readonly processedOn: number | null;
  readonly finishedOn: number | null;
  readonly timings: JobTimings;
  readonly data: unknown;
  readonly opts: unknown;
  readonly returnvalue: unknown;
  readonly failedReason: string | null;
  readonly stacktrace: string[];
  readonly progress: number | string | boolean | object | null;
  readonly errorSignature: string | null;
  readonly parentKey: string | null;
}

/**
 * Map a BullMQ job to a bullwatch DTO. The payload (`data`, `returnvalue`) is
 * passed through for live rendering — it is never routed to the metrics store.
 */
export function toJobDTO(job: JobLike, queue: string, now: number): JobDTO {
  const failedReason = job.failedReason ?? null;
  return {
    id: job.id ?? null,
    name: job.name,
    queue,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    processedOn: job.processedOn ?? null,
    finishedOn: job.finishedOn ?? null,
    timings: deriveTimings({
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      now,
    }),
    data: job.data,
    opts: job.opts,
    returnvalue: job.returnvalue ?? null,
    failedReason,
    stacktrace: job.stacktrace ?? [],
    progress: job.progress ?? null,
    errorSignature: errorSignature(failedReason),
    parentKey: job.parentKey ?? null,
  };
}
